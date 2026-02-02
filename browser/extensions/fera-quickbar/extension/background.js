/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const PLANNER_BASE_URL = "https://himanshu-711-fera-ai-assistant.hf.space";
const ALLOWED_TOOLS = new Set([
  "click",
  "open_tab",
  "press_key",
  "scroll",
  "search_default",
  "summarize_page",
  "type",
  "wait_for_user_auth",
]);

const tabStates = new Map();
const runningPlans = new Map();
let cachedSchema = null;

function defaultTabState() {
  return {
    chatHistory: [],
    sharedTabContext: null,
    agentState: "idle",
    lastPlan: null,
    logs: [],
  };
}

async function loadStoredState(tabId) {
  let key = `tabState:${tabId}`;
  let stored = await browser.storage.local.get(key);
  return stored[key] || null;
}

async function persistTabState(tabId) {
  let state = tabStates.get(tabId);
  if (!state) {
    return;
  }
  let key = `tabState:${tabId}`;
  await browser.storage.local.set({ [key]: state });
}

async function getTabState(tabId) {
  if (!tabStates.has(tabId)) {
    let stored = await loadStoredState(tabId);
    tabStates.set(tabId, stored || defaultTabState());
  }
  return tabStates.get(tabId);
}

function notifyState(tabId) {
  let state = tabStates.get(tabId);
  if (!state) {
    return;
  }
  browser.runtime.sendMessage({
    type: "tabStateUpdated",
    tabId,
    state,
  });
}

async function appendLog(tabId, entry) {
  let state = await getTabState(tabId);
  state.logs.push(entry);
  await persistTabState(tabId);
  notifyState(tabId);
}

async function appendChat(tabId, message) {
  let state = await getTabState(tabId);
  state.chatHistory.push(message);
  await persistTabState(tabId);
  notifyState(tabId);
}

async function setAgentState(tabId, status) {
  let state = await getTabState(tabId);
  state.agentState = status;
  await persistTabState(tabId);
  notifyState(tabId);
}

async function fetchPlannerSchema() {
  if (cachedSchema) {
    return cachedSchema;
  }
  try {
    let response = await fetch(`${PLANNER_BASE_URL}/schema`);
    if (response.ok) {
      cachedSchema = await response.json();
    }
  } catch (error) {
    cachedSchema = null;
  }
  return cachedSchema;
}

function validatePlan(plan) {
  if (!plan || Array.isArray(plan) || typeof plan !== "object") {
    throw new Error("Planner returned invalid JSON object");
  }

  if (!Array.isArray(plan.steps)) {
    throw new Error("Planner response missing steps");
  }

  for (let step of plan.steps) {
    if (!step || typeof step.tool !== "string") {
      throw new Error("Planner step missing tool");
    }
    if (!ALLOWED_TOOLS.has(step.tool)) {
      throw new Error(`Planner tool not allowed: ${step.tool}`);
    }
  }

  return plan;
}

function createRunState() {
  return {
    cancelled: false,
    paused: false,
    resumePromise: null,
    resumeResolver: null,
  };
}

function cancelRun(tabId) {
  let run = runningPlans.get(tabId);
  if (!run) {
    return;
  }
  run.cancelled = true;
  if (run.resumeResolver) {
    run.resumeResolver();
  }
}

async function ensureCursor(tabId, visible) {
  try {
    await browser.tabs.sendMessage(tabId, {
      type: visible ? "showCursor" : "hideCursor",
    });
  } catch (error) {
    await appendLog(tabId, {
      level: "error",
      message: "Failed to update cursor overlay",
      detail: String(error),
    });
  }
}

function normalizeTabInfo(tab) {
  let url = tab.url || "";
  let domain = "";
  try {
    domain = new URL(url).hostname;
  } catch (error) {
    domain = "";
  }
  return {
    url,
    title: tab.title || "",
    domain,
  };
}

function isEmailInboxUrl(url) {
  try {
    let parsed = new URL(url);
    let host = parsed.hostname.toLowerCase();
    let path = parsed.pathname.toLowerCase();
    return (
      host.includes("mail.") ||
      host.includes("gmail.com") ||
      host.includes("outlook.") ||
      host.includes("yahoo.com") ||
      path.includes("/mail")
    );
  } catch (error) {
    return false;
  }
}

async function executeStep(tabId, step) {
  if (step.tool === "open_tab") {
    let targetUrl = step.args?.url;
    if (!targetUrl) {
      throw new Error("open_tab missing url");
    }
    if (isEmailInboxUrl(targetUrl)) {
      throw new Error("Opening email inbox is blocked");
    }
    await browser.tabs.create({ url: targetUrl });
    return { ok: true };
  }

  if (step.tool === "search_default") {
    let config = await browser.feraSearch.getConfig();
    let query = step.args?.query || "";
    let tab = step.args?.tab || "all";
    let baseUrl = config.uiUrl || "https://search.fera.ai";
    let url = `${baseUrl}/?q=${encodeURIComponent(query)}&tab=${encodeURIComponent(tab)}`;
    await browser.tabs.update(tabId, { url });
    return { ok: true };
  }

  if (step.tool === "wait_for_user_auth") {
    return { wait: true };
  }

  let response = await browser.tabs.sendMessage(tabId, {
    type: "execute",
    tool: step.tool,
    args: step.args || {},
  });

  if (response?.error) {
    throw new Error(response.error);
  }
  return response || { ok: true };
}

async function runPlan(tabId, userGoal, options) {
  let state = await getTabState(tabId);
  if (state.agentState === "running") {
    return { error: "Agent already running" };
  }

  let runState = createRunState();
  runningPlans.set(tabId, runState);
  state.logs = [];
  await setAgentState(tabId, "running");
  await ensureCursor(tabId, true);

  try {
    await fetchPlannerSchema();
    let tab = await browser.tabs.get(tabId);
    let tabInfo = normalizeTabInfo(tab);
    let payload = {
      user_goal: userGoal,
      tab: state.sharedTabContext || tabInfo,
      user_sent_tab: Boolean(state.sharedTabContext),
      user_confirmed_task_start: true,
      mode: options.mode,
    };
    if (options.engineOverride) {
      payload.search_engine_override = options.engineOverride;
    }

    let response = await fetch(`${PLANNER_BASE_URL}/plan`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Planner error ${response.status}`);
    }

    let plan = await response.json();
    plan = validatePlan(plan);
    state.lastPlan = plan;
    await appendLog(tabId, {
      level: "info",
      message: "Plan received",
      detail: plan.summary || "",
    });
    notifyState(tabId);

    for (let step of plan.steps) {
      if (runState.cancelled) {
        break;
      }

      await appendLog(tabId, {
        level: "info",
        message: `Executing ${step.tool}`,
        detail: JSON.stringify(step.args || {}),
      });

      let result = await executeStep(tabId, step);

      if (result?.wait) {
        runState.paused = true;
        await setAgentState(tabId, "paused");
        browser.runtime.sendMessage({
          type: "authRequired",
          tabId,
        });

        await appendLog(tabId, {
          level: "info",
          message: "Waiting for user authentication",
        });

        runState.resumePromise = new Promise(resolve => {
          runState.resumeResolver = resolve;
        });

        await runState.resumePromise;
        runState.resumePromise = null;
        runState.resumeResolver = null;
        if (runState.cancelled) {
          break;
        }
        await setAgentState(tabId, "running");
        continue;
      }

      if (result?.summary) {
        await appendLog(tabId, {
          level: "info",
          message: "Summary",
          detail: result.summary,
        });
      }
    }

    if (runState.cancelled) {
      await appendLog(tabId, {
        level: "warning",
        message: "Execution cancelled",
      });
    } else {
      await appendLog(tabId, {
        level: "info",
        message: "Execution completed",
      });
    }
  } catch (error) {
    await appendLog(tabId, {
      level: "error",
      message: "Execution failed",
      detail: String(error),
    });
  } finally {
    await ensureCursor(tabId, false);
    await setAgentState(tabId, "idle");
    runningPlans.delete(tabId);
  }

  return { ok: true };
}

browser.runtime.onMessage.addListener(async message => {
  if (!message || !message.type) {
    return null;
  }

  if (message.type === "getTabState") {
    let state = await getTabState(message.tabId);
    return state;
  }

  if (message.type === "updateChat") {
    await appendChat(message.tabId, message.entry);
    return { ok: true };
  }

  if (message.type === "collectTabContext") {
    let response = await browser.tabs.sendMessage(message.tabId, {
      type: "collectContext",
    });
    let state = await getTabState(message.tabId);
    state.sharedTabContext = response;
    await appendChat(message.tabId, {
      role: "system",
      content: "✅ Tab context shared.",
      timestamp: Date.now(),
    });
    await persistTabState(message.tabId);
    notifyState(message.tabId);
    return response;
  }

  if (message.type === "startTask") {
    return runPlan(message.tabId, message.userGoal, message.options || {});
  }

  if (message.type === "stopTask") {
    cancelRun(message.tabId);
    await ensureCursor(message.tabId, false);
    await setAgentState(message.tabId, "idle");
    return { ok: true };
  }

  if (message.type === "continueAuth") {
    let run = runningPlans.get(message.tabId);
    if (run?.resumeResolver) {
      run.resumeResolver();
    }
    return { ok: true };
  }

  if (message.type === "escapeStop") {
    cancelRun(message.tabId);
    await ensureCursor(message.tabId, false);
    await setAgentState(message.tabId, "idle");
    return { ok: true };
  }

  return null;
});

browser.tabs.onRemoved.addListener(tabId => {
  tabStates.delete(tabId);
  runningPlans.delete(tabId);
  let key = `tabState:${tabId}`;
  browser.storage.local.remove(key);
});

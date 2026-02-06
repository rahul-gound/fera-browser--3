/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const elements = {
  tabTitle: document.getElementById("tab-title"),
  tabDomain: document.getElementById("tab-domain"),
  chat: document.getElementById("chat"),
  composerInput: document.getElementById("composer-input"),
  modeSelect: document.getElementById("mode-select"),
  engineSelect: document.getElementById("engine-select"),
  modelSelect: document.getElementById("model-select"),
  modelApiKey: document.getElementById("model-api-key"),
  sendTab: document.getElementById("send-tab"),
  startTask: document.getElementById("start-task"),
  stopTask: document.getElementById("stop-task"),
  addMessage: document.getElementById("add-message"),
  planJson: document.getElementById("plan-json"),
  logs: document.getElementById("execution-logs"),
  engineList: document.getElementById("engine-list"),
  engineForm: document.getElementById("engine-form"),
  engineName: document.getElementById("engine-name"),
  engineTemplate: document.getElementById("engine-template"),
  authModal: document.getElementById("auth-modal"),
  continueAuth: document.getElementById("continue-auth"),
};

let currentTabId = null;
let currentState = null;
let currentConfig = null;
let currentAssistantConfig = null;

const ASSISTANT_CONFIG_KEY = "assistantConfig";
const DEFAULT_ASSISTANT_CONFIG = {
  model: "default",
  visionApiKey: "",
};

async function getActiveTab() {
  let tabs = await browser.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function renderChat(state) {
  elements.chat.innerHTML = "";
  if (!state?.chatHistory) {
    return;
  }
  for (let entry of state.chatHistory) {
    let bubble = document.createElement("div");
    bubble.className = `chat-bubble ${entry.role}`;
    bubble.textContent = entry.content;
    elements.chat.appendChild(bubble);
  }
  elements.chat.scrollTop = elements.chat.scrollHeight;
}

function renderLogs(state) {
  elements.logs.innerHTML = "";
  if (!state?.logs) {
    return;
  }
  for (let entry of state.logs) {
    let div = document.createElement("div");
    div.className = "log-entry";
    let detail = entry.detail ? ` ${entry.detail}` : "";
    div.textContent = `[${entry.level}] ${entry.message}${detail}`;
    elements.logs.appendChild(div);
  }
}

function renderPlan(state) {
  if (!state?.lastPlan) {
    elements.planJson.textContent = "";
    return;
  }
  elements.planJson.textContent = JSON.stringify(state.lastPlan, null, 2);
}

function updateState(state) {
  currentState = state;
  renderChat(state);
  renderPlan(state);
  renderLogs(state);
}

function updateTabHeader(tab) {
  if (!tab) {
    elements.tabTitle.textContent = "";
    elements.tabDomain.textContent = "";
    return;
  }
  elements.tabTitle.textContent = tab.title || "";
  let domain = "";
  try {
    domain = new URL(tab.url || "").hostname;
  } catch (error) {
    domain = "";
  }
  elements.tabDomain.textContent = domain;
}

function renderEngineSelect(config) {
  elements.engineSelect.innerHTML = "";
  for (let engine of config.engines) {
    let option = document.createElement("option");
    option.value = engine.name;
    option.textContent = engine.name;
    elements.engineSelect.appendChild(option);
  }
  elements.engineSelect.value = config.defaultEngine;
}

function renderEngineSettings(config) {
  elements.engineList.innerHTML = "";
  for (let engine of config.engines) {
    let row = document.createElement("div");
    row.className = "engine-row";

    let radio = document.createElement("input");
    radio.type = "radio";
    radio.name = "default-engine";
    radio.checked = engine.name === config.defaultEngine;
    radio.addEventListener("change", () => setDefaultEngine(engine.name));

    let nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.value = engine.name;

    let templateInput = document.createElement("input");
    templateInput.type = "text";
    templateInput.value = engine.template;

    let saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "Save";
    saveButton.addEventListener("click", () =>
      updateEngine(engine.name, nameInput.value, templateInput.value)
    );

    let deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => removeEngine(engine.name));

    row.appendChild(radio);
    row.appendChild(nameInput);
    row.appendChild(templateInput);
    row.appendChild(saveButton);
    row.appendChild(deleteButton);
    elements.engineList.appendChild(row);
  }
}

async function loadSearchConfig() {
  currentConfig = await browser.feraSearch.getConfig();
  renderEngineSelect(currentConfig);
  renderEngineSettings(currentConfig);
}

function applyAssistantConfig(config) {
  elements.modelSelect.value = config.model || DEFAULT_ASSISTANT_CONFIG.model;
  elements.modelApiKey.value = config.visionApiKey || "";
  elements.modelApiKey.disabled = elements.modelSelect.value !== "vision-api";
}

async function loadAssistantConfig() {
  let stored = await browser.storage.local.get(ASSISTANT_CONFIG_KEY);
  currentAssistantConfig = stored[ASSISTANT_CONFIG_KEY] || DEFAULT_ASSISTANT_CONFIG;
  applyAssistantConfig(currentAssistantConfig);
}

async function persistAssistantConfig() {
  currentAssistantConfig = {
    model: elements.modelSelect.value,
    visionApiKey: elements.modelApiKey.value.trim(),
  };
  await browser.storage.local.set({
    [ASSISTANT_CONFIG_KEY]: currentAssistantConfig,
  });
}

async function setDefaultEngine(name) {
  if (!currentConfig) {
    return;
  }
  currentConfig.defaultEngine = name;
  currentConfig = await browser.feraSearch.setConfig(currentConfig);
  renderEngineSelect(currentConfig);
  renderEngineSettings(currentConfig);
}

async function updateEngine(oldName, newName, newTemplate) {
  if (!currentConfig) {
    return;
  }
  let engines = currentConfig.engines.map(engine => {
    if (engine.name === oldName) {
      return { name: newName, template: newTemplate };
    }
    return engine;
  });
  currentConfig = await browser.feraSearch.setConfig({
    engines,
    defaultEngine: currentConfig.defaultEngine === oldName ? newName : currentConfig.defaultEngine,
    uiUrl: currentConfig.uiUrl,
  });
  renderEngineSelect(currentConfig);
  renderEngineSettings(currentConfig);
}

async function removeEngine(name) {
  if (!currentConfig) {
    return;
  }
  let engines = currentConfig.engines.filter(engine => engine.name !== name);
  if (!engines.length) {
    return;
  }
  let defaultEngine = currentConfig.defaultEngine;
  if (!engines.some(engine => engine.name === defaultEngine)) {
    defaultEngine = engines[0].name;
  }
  currentConfig = await browser.feraSearch.setConfig({
    engines,
    defaultEngine,
    uiUrl: currentConfig.uiUrl,
  });
  renderEngineSelect(currentConfig);
  renderEngineSettings(currentConfig);
}

async function addEngine(event) {
  event.preventDefault();
  let name = elements.engineName.value.trim();
  let template = elements.engineTemplate.value.trim();
  if (!name || !template) {
    return;
  }
  let engines = currentConfig.engines.concat({ name, template });
  currentConfig = await browser.feraSearch.setConfig({
    engines,
    defaultEngine: currentConfig.defaultEngine,
    uiUrl: currentConfig.uiUrl,
  });
  elements.engineName.value = "";
  elements.engineTemplate.value = "";
  renderEngineSelect(currentConfig);
  renderEngineSettings(currentConfig);
}

async function refreshState() {
  let tab = await getActiveTab();
  currentTabId = tab?.id || null;
  updateTabHeader(tab);
  if (!currentTabId) {
    return;
  }
  let state = await browser.runtime.sendMessage({
    type: "getTabState",
    tabId: currentTabId,
  });
  updateState(state);
}

async function addChatMessage(role, content) {
  if (!currentTabId) {
    return;
  }
  let entry = { role, content, timestamp: Date.now() };
  await browser.runtime.sendMessage({
    type: "updateChat",
    tabId: currentTabId,
    entry,
  });
}

async function sendTabContext() {
  if (!currentTabId) {
    return;
  }
  await browser.runtime.sendMessage({
    type: "collectTabContext",
    tabId: currentTabId,
  });
}

async function startTask() {
  if (!currentTabId) {
    return;
  }
  let goal = elements.composerInput.value.trim();
  if (!goal) {
    return;
  }
  if (elements.modelSelect.value === "vision-api" && !elements.modelApiKey.value.trim()) {
    await addChatMessage("system", "Vision API requires a key before starting.");
    return;
  }
  await addChatMessage("user", goal);
  elements.composerInput.value = "";
  await browser.runtime.sendMessage({
    type: "startTask",
    tabId: currentTabId,
    userGoal: goal,
    options: {
      mode: elements.modeSelect.value,
      engineOverride: elements.engineSelect.value,
      model: elements.modelSelect.value,
      visionApiKey: elements.modelApiKey.value.trim(),
    },
  });
}

async function stopTask() {
  if (!currentTabId) {
    return;
  }
  await browser.runtime.sendMessage({
    type: "stopTask",
    tabId: currentTabId,
  });
}

browser.runtime.onMessage.addListener(message => {
  if (!message || !message.type) {
    return;
  }
  if (message.type === "tabStateUpdated" && message.tabId === currentTabId) {
    updateState(message.state);
  }
  if (message.type === "authRequired" && message.tabId === currentTabId) {
    elements.authModal.hidden = false;
  }
});

browser.tabs.onActivated.addListener(() => {
  refreshState();
});

browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tabId === currentTabId && changeInfo.title) {
    updateTabHeader(tab);
  }
});

elements.sendTab.addEventListener("click", sendTabContext);

if (elements.addMessage) {
  elements.addMessage.addEventListener("click", () => {
    let text = elements.composerInput.value.trim();
    if (!text) {
      return;
    }
    addChatMessage("user", text);
    elements.composerInput.value = "";
  });
}

elements.startTask.addEventListener("click", startTask);

elements.stopTask.addEventListener("click", stopTask);

elements.engineForm.addEventListener("submit", addEngine);

elements.modelSelect.addEventListener("change", () => {
  elements.modelApiKey.disabled = elements.modelSelect.value !== "vision-api";
  persistAssistantConfig();
});

elements.modelApiKey.addEventListener("input", () => {
  persistAssistantConfig();
});

elements.continueAuth.addEventListener("click", async () => {
  elements.authModal.hidden = true;
  if (currentTabId) {
    await browser.runtime.sendMessage({
      type: "continueAuth",
      tabId: currentTabId,
    });
  }
});

loadSearchConfig();
loadAssistantConfig();
refreshState();

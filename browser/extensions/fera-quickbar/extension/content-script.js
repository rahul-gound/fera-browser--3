/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

const CURSOR_ID = "fera-ai-cursor";

function ensureCursor() {
  let existing = document.getElementById(CURSOR_ID);
  if (existing) {
    return existing;
  }
  let cursor = document.createElement("div");
  cursor.id = CURSOR_ID;
  cursor.style.position = "fixed";
  cursor.style.width = "18px";
  cursor.style.height = "18px";
  cursor.style.borderRadius = "50%";
  cursor.style.background = "rgba(255, 140, 0, 0.9)";
  cursor.style.boxShadow = "0 0 0 4px rgba(255, 140, 0, 0.3)";
  cursor.style.zIndex = "2147483647";
  cursor.style.pointerEvents = "none";
  cursor.style.top = "16px";
  cursor.style.right = "16px";
  document.documentElement.appendChild(cursor);
  return cursor;
}

function moveCursorToElement(element) {
  if (!element) {
    return;
  }
  let rect = element.getBoundingClientRect();
  let cursor = ensureCursor();
  let x = rect.left + rect.width / 2;
  let y = rect.top + rect.height / 2;
  cursor.style.left = `${Math.max(8, x)}px`;
  cursor.style.top = `${Math.max(8, y)}px`;
  cursor.style.right = "auto";
}

function hideCursor() {
  let cursor = document.getElementById(CURSOR_ID);
  if (cursor) {
    cursor.remove();
  }
}

function isBlockedInput(element, text) {
  if (!element) {
    return true;
  }
  let type = (element.getAttribute("type") || "").toLowerCase();
  if (type === "password") {
    return true;
  }
  let hints = [
    element.getAttribute("name"),
    element.getAttribute("id"),
    element.getAttribute("placeholder"),
    element.getAttribute("aria-label"),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (hints.includes("otp") || hints.includes("one-time") || hints.includes("verification code")) {
    return true;
  }
  if (typeof text === "string" && /^\d{4,8}$/.test(text) && hints.includes("code")) {
    return true;
  }
  return false;
}

function resolveTarget(args) {
  if (args.selector) {
    return document.querySelector(args.selector);
  }
  if (typeof args.x === "number" && typeof args.y === "number") {
    return document.elementFromPoint(args.x, args.y);
  }
  return null;
}

function dispatchInput(element, value) {
  element.focus();
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function handleClick(args) {
  let target = resolveTarget(args);
  if (!target) {
    throw new Error("Click target not found");
  }
  moveCursorToElement(target);
  target.click();
  return { ok: true };
}

async function handleType(args) {
  let target = resolveTarget(args);
  let text = args.text || "";
  if (!target) {
    throw new Error("Type target not found");
  }
  if (isBlockedInput(target, text)) {
    throw new Error("Typing into sensitive fields is blocked");
  }
  moveCursorToElement(target);
  if (target.isContentEditable) {
    target.focus();
    document.execCommand("insertText", false, text);
    return { ok: true };
  }
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") {
    dispatchInput(target, text);
    return { ok: true };
  }
  throw new Error("Target is not editable");
}

async function handlePressKey(args) {
  let key = args.key || "";
  let target = document.activeElement || document.body;
  if (!key) {
    throw new Error("Missing key to press");
  }
  moveCursorToElement(target);
  let eventOptions = { key, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
  target.dispatchEvent(new KeyboardEvent("keyup", eventOptions));
  return { ok: true };
}

async function handleScroll(args) {
  let amount = typeof args.amount === "number" ? args.amount : 300;
  let dx = 0;
  let dy = 0;
  if (args.direction === "up") {
    dy = -amount;
  } else if (args.direction === "down") {
    dy = amount;
  } else if (args.direction === "left") {
    dx = -amount;
  } else if (args.direction === "right") {
    dx = amount;
  } else {
    dy = amount;
  }
  window.scrollBy({ top: dy, left: dx, behavior: "smooth" });
  let cursor = ensureCursor();
  cursor.style.left = "16px";
  cursor.style.top = "16px";
  cursor.style.right = "auto";
  return { ok: true };
}

async function handleSummarize() {
  let text = document.body?.innerText || "";
  let summary = text.trim().slice(0, 12000);
  return { summary };
}

function collectContext() {
  let selection = window.getSelection()?.toString().trim() || "";
  let bodyText = document.body?.innerText || "";
  let links = Array.from(document.querySelectorAll("a[href]"))
    .map(link => ({
      text: link.textContent.trim().slice(0, 200),
      href: link.href,
    }))
    .filter(link => link.text || link.href)
    .slice(0, 30);
  let inputs = Array.from(document.querySelectorAll("input, textarea, select"))
    .map(input => ({
      type: input.getAttribute("type") || input.tagName.toLowerCase(),
      name: input.getAttribute("name") || "",
      id: input.id || "",
      placeholder: input.getAttribute("placeholder") || "",
    }))
    .slice(0, 30);
  return {
    url: window.location.href,
    title: document.title,
    selectedText: selection.slice(0, 2000),
    visibleText: bodyText.trim().slice(0, 12000),
    links,
    inputs,
  };
}

browser.runtime.onMessage.addListener(async message => {
  if (!message || !message.type) {
    return null;
  }

  if (message.type === "collectContext") {
    return collectContext();
  }

  if (message.type === "showCursor") {
    ensureCursor();
    return { ok: true };
  }

  if (message.type === "hideCursor") {
    hideCursor();
    return { ok: true };
  }

  if (message.type === "execute") {
    try {
      switch (message.tool) {
        case "click":
          return await handleClick(message.args || {});
        case "type":
          return await handleType(message.args || {});
        case "press_key":
          return await handlePressKey(message.args || {});
        case "scroll":
          return await handleScroll(message.args || {});
        case "summarize_page":
          return await handleSummarize();
        default:
          return { error: "Unsupported tool" };
      }
    } catch (error) {
      return { error: String(error) };
    }
  }

  return null;
});

window.addEventListener(
  "keydown",
  event => {
    if (event.key === "Escape") {
      browser.runtime.sendMessage({ type: "escapeStop" });
    }
  },
  true
);

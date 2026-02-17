/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fera AI Assistant - chat interface powered by Sarvam-M.
 *
 * To configure the AI assistant, set the API key in about:config:
 *   fera.ai.assistant.api.key = YOUR_API_KEY
 *
 * The model defaults to "sarvam-m" and can be changed via:
 *   fera.ai.assistant.model
 */

var feraAIAssistant = {
  _messages: [],

  init() {
    let input = document.getElementById("fera-ai-input");
    if (input) {
      input.addEventListener("keypress", e => {
        if (e.key === "Enter") {
          this.sendMessage();
        }
      });
    }
  },

  toggle() {
    let panel = document.getElementById("fera-ai-panel");
    let splitter = document.getElementById("fera-ai-splitter");
    if (panel) {
      panel.hidden = !panel.hidden;
    }
    if (splitter) {
      splitter.hidden = !splitter.hidden;
    }
  },

  sendMessage() {
    let input = document.getElementById("fera-ai-input");
    if (!input) {
      return;
    }
    let text = input.value.trim();
    if (!text) {
      return;
    }
    input.value = "";
    this._appendMessage("user", text);
    this._messages.push({ role: "user", content: text });

    let apiKey = Services.prefs.getStringPref("fera.ai.assistant.api.key", "");
    if (!apiKey) {
      this._appendMessage(
        "assistant",
        "API key not configured. Set fera.ai.assistant.api.key in about:config or in Settings."
      );
      return;
    }
    this._callAPI(apiKey);
  },

  async _callAPI(apiKey) {
    let model = Services.prefs.getStringPref(
      "fera.ai.assistant.model",
      "sarvam-m"
    );
    try {
      let response = await fetch(
        "https://api.sarvam.ai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            model,
            messages: this._messages,
          }),
        }
      );
      if (!response.ok) {
        this._appendMessage(
          "assistant",
          "Error: " + response.status + " " + response.statusText
        );
        return;
      }
      let data = await response.json();
      let reply =
        data.choices?.[0]?.message?.content || "No response received.";
      this._messages.push({ role: "assistant", content: reply });
      this._appendMessage("assistant", reply);
    } catch (e) {
      this._appendMessage("assistant", "Connection error: " + e.message);
    }
  },

  _appendMessage(role, text) {
    let container = document.getElementById("fera-ai-messages");
    if (!container) {
      return;
    }
    let msg = document.createElementNS(
      "http://www.w3.org/1999/xhtml",
      "div"
    );
    msg.className = "fera-ai-message fera-ai-message-" + role;
    msg.textContent = text;
    container.appendChild(msg);
    container.scrollTop = container.scrollHeight;
  },
};

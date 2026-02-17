/* -*- indent-tabs-mode: nil; js-indent-level: 2 -*-
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/* Fera Quick Bar - provides quick access links, search, and privacy tools. */

var feraQuickBar = {
  _defaultShortcuts: [
    { label: "Gmail", url: "https://mail.google.com" },
    { label: "YouTube", url: "https://www.youtube.com" },
    { label: "GitHub", url: "https://github.com" },
    { label: "Wikipedia", url: "https://www.wikipedia.org" },
    { label: "Reddit", url: "https://www.reddit.com" },
    { label: "Twitter", url: "https://x.com" },
  ],

  init() {
    let enabled = Services.prefs.getBoolPref("fera.quickbar.enabled", true);
    let panel = document.getElementById("fera-quickbar");
    if (panel) {
      panel.hidden = !enabled;
    }
    this._renderShortcuts();
    this._setupSearch();
    this._updateShieldState();
  },

  toggle() {
    let panel = document.getElementById("fera-quickbar");
    if (panel) {
      panel.hidden = !panel.hidden;
    }
  },

  _renderShortcuts() {
    let container = document.getElementById("fera-quickbar-links");
    if (!container) {
      return;
    }
    while (container.firstChild) {
      container.firstChild.remove();
    }
    let shortcuts = this._loadShortcuts();
    for (let s of shortcuts) {
      let btn = document.createXULElement("toolbarbutton");
      btn.setAttribute("label", s.label);
      btn.setAttribute("tooltiptext", s.url);
      btn.setAttribute("class", "fera-quickbar-link");
      btn.addEventListener("command", () => {
        openTrustedLinkIn(s.url, "tab");
      });
      container.appendChild(btn);
    }
  },

  _loadShortcuts() {
    try {
      let stored = Services.prefs.getStringPref(
        "fera.quickbar.shortcuts",
        ""
      );
      if (stored) {
        return JSON.parse(stored);
      }
    } catch (e) {
      // Fall through to defaults.
    }
    return this._defaultShortcuts;
  },

  _setupSearch() {
    let input = document.getElementById("fera-quickbar-search-input");
    if (!input) {
      return;
    }
    input.addEventListener("keypress", e => {
      if (e.key === "Enter") {
        let query = input.value.trim();
        if (query) {
          let searchUrl = Services.prefs.getStringPref(
            "fera.quickbar.search.url",
            "https://rahul-gound.github.io/fera-search-demo-2"
          );
          let url = searchUrl + "?q=" + encodeURIComponent(query);
          openTrustedLinkIn(url, "tab");
          input.value = "";
        }
      }
    });
  },

  toggleShield() {
    let enabled = Services.prefs.getBoolPref(
      "fera.privacy.shield.enabled",
      true
    );
    Services.prefs.setBoolPref("fera.privacy.shield.enabled", !enabled);
    Services.prefs.setBoolPref(
      "privacy.trackingprotection.enabled",
      !enabled
    );
    this._updateShieldState();
  },

  _updateShieldState() {
    let btn = document.getElementById("fera-tool-shield");
    if (!btn) {
      return;
    }
    let enabled = Services.prefs.getBoolPref(
      "fera.privacy.shield.enabled",
      true
    );
    btn.setAttribute("label", enabled ? "Shield: ON" : "Shield: OFF");
  },

  toggleHistory() {
    let enabled = Services.prefs.getBoolPref("places.history.enabled", false);
    Services.prefs.setBoolPref("places.history.enabled", !enabled);
    let btn = document.getElementById("fera-tool-history");
    if (btn) {
      btn.setAttribute(
        "label",
        !enabled ? "History: ON" : "History: OFF"
      );
    }
  },
};

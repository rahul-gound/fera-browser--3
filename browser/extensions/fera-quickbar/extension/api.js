/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";

var { ExtensionError } = ExtensionUtils;

const PREF_ENGINES = "fera.search.engines";
const PREF_DEFAULT_ENGINE = "fera.search.defaultEngine";
const PREF_UI_URL = "fera.search.uiUrl";
const MANAGED_ATTR = "feraManaged";
const TEMPLATE_ATTR = "feraTemplate";

const DEFAULT_ENGINES = [
  {
    name: "Fera Search",
    template: "https://fera-search.tech/?q={searchTerms}",
  },
  {
    name: "Fera",
    template: "https://search.fera.ai/?q={searchTerms}&tab=all",
  },
  {
    name: "Google",
    template: "https://www.google.com/search?q={searchTerms}",
  },
  {
    name: "Bing",
    template: "https://www.bing.com/search?q={searchTerms}",
  },
  {
    name: "DuckDuckGo",
    template: "https://duckduckgo.com/?q={searchTerms}",
  },
  {
    name: "Brave",
    template: "https://search.brave.com/search?q={searchTerms}",
  },
];

function getStoredConfig() {
  let engines;
  let defaultEngine;
  let uiUrl;
  try {
    if (Services.prefs.prefHasUserValue(PREF_ENGINES)) {
      engines = JSON.parse(Services.prefs.getStringPref(PREF_ENGINES));
    }
  } catch (error) {
    engines = null;
  }

  if (!Array.isArray(engines) || !engines.length) {
    engines = DEFAULT_ENGINES;
  }

  if (Services.prefs.prefHasUserValue(PREF_DEFAULT_ENGINE)) {
    defaultEngine = Services.prefs.getStringPref(PREF_DEFAULT_ENGINE);
  }

  if (!defaultEngine || !engines.some(engine => engine.name === defaultEngine)) {
    defaultEngine = engines[0].name;
  }

  try {
    uiUrl = Services.prefs.getStringPref(PREF_UI_URL);
  } catch (error) {
    uiUrl = undefined;
  }

  return {
    engines,
    defaultEngine,
    uiUrl,
  };
}

function storeConfig(config) {
  Services.prefs.setStringPref(PREF_ENGINES, JSON.stringify(config.engines));
  Services.prefs.setStringPref(PREF_DEFAULT_ENGINE, config.defaultEngine);
  if (config.uiUrl) {
    Services.prefs.setStringPref(PREF_UI_URL, config.uiUrl);
  }
}

async function ensureEngine(config) {
  await Services.search.promiseInitialized;

  let engines = await Services.search.getEngines();
  let managedEngines = engines.filter(engine => engine.getAttr(MANAGED_ATTR));
  let configMap = new Map(
    config.engines.map(engine => [engine.name, engine.template])
  );

  for (let engine of managedEngines) {
    if (!configMap.has(engine.name)) {
      await Services.search.removeEngine(
        engine,
        Ci.nsISearchService.CHANGE_REASON_APP_DEFAULT
      );
    }
  }

  for (let entry of config.engines) {
    let existing = Services.search.getEngineByName(entry.name);
    if (existing && existing.getAttr(MANAGED_ATTR)) {
      if (existing.getAttr(TEMPLATE_ATTR) === entry.template) {
        continue;
      }
      await Services.search.removeEngine(
        existing,
        Ci.nsISearchService.CHANGE_REASON_APP_DEFAULT
      );
      existing = null;
    }

    if (!existing) {
      let newEngine = await Services.search.addUserEngine({
        name: entry.name,
        url: entry.template,
      });
      newEngine.setAttr(MANAGED_ATTR, true);
      newEngine.setAttr(TEMPLATE_ATTR, entry.template);
    }
  }

  let defaultEngine = Services.search.getEngineByName(config.defaultEngine);
  if (!defaultEngine) {
    defaultEngine = Services.search.getEngineByName(config.engines[0].name);
  }

  if (defaultEngine) {
    await Services.search.setDefault(
      defaultEngine,
      Ci.nsISearchService.CHANGE_REASON_APP_DEFAULT
    );
  }
}

function normalizeConfig(config) {
  if (!config || !Array.isArray(config.engines)) {
    throw new ExtensionError("Invalid search engine configuration");
  }

  let engines = config.engines
    .map(engine => ({
      name: String(engine.name || "").trim(),
      template: String(engine.template || "").trim(),
    }))
    .filter(engine => engine.name && engine.template);

  if (!engines.length) {
    throw new ExtensionError("At least one search engine is required");
  }

  for (let engine of engines) {
    if (!engine.template.includes("{searchTerms}")) {
      throw new ExtensionError("Search template must include {searchTerms}");
    }
  }

  let defaultEngine = String(config.defaultEngine || "").trim();
  if (!engines.some(engine => engine.name === defaultEngine)) {
    defaultEngine = engines[0].name;
  }

  return {
    engines,
    defaultEngine,
    uiUrl: config.uiUrl ? String(config.uiUrl).trim() : undefined,
  };
}

this.feraSearch = class extends ExtensionAPI {
  onStartup() {
    let config = getStoredConfig();
    storeConfig(config);
    ensureEngine(config).catch(() => {});
  }

  getAPI() {
    return {
      feraSearch: {
        async getConfig() {
          return getStoredConfig();
        },

        async setConfig(config) {
          let normalized = normalizeConfig(config);
          storeConfig(normalized);
          await ensureEngine(normalized);
          return normalized;
        },

        async applyConfig() {
          let config = getStoredConfig();
          storeConfig(config);
          await ensureEngine(config);
          return config;
        },
      },
    };
  }
};

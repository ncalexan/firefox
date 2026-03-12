/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

import { GeckoViewUtils } from "resource://gre/modules/GeckoViewUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  EventDispatcher: "resource://gre/modules/Messaging.sys.mjs",
  GeckoViewIPPSignInWatcher:
    "resource://gre/modules/GeckoViewIPPSignInWatcher.sys.mjs",
  IPPProxyManager:
    "moz-src:///toolkit/components/ipprotection/IPPProxyManager.sys.mjs",
  IPProtectionActivator:
    "moz-src:///toolkit/components/ipprotection/IPProtectionActivator.sys.mjs",
  IPProtectionService:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
});

const { debug, warn } = GeckoViewUtils.initLogging("GeckoViewIPProtection");

let initialized = false;
let listening = false;

function ensureInitialized() {
  if (initialized) {
    return;
  }
  initialized = true;
  lazy.IPProtectionActivator.addHelpers([lazy.GeckoViewIPPSignInWatcher]);
  lazy.IPProtectionActivator.init();
}

function ensureListening() {
    // debug`ensureListening ${listening}`;
  if (listening) {
    return;
  }
  listening = true;
  lazy.IPPProxyManager.addEventListener(
    "IPPProxyManager:StateChanged",
    GeckoViewIPProtection
  );
  lazy.IPPProxyManager.addEventListener(
    "IPPProxyManager:UsageChanged",
    GeckoViewIPProtection
  );
  lazy.IPProtectionService.addEventListener(
    "IPProtectionService:StateChanged",
    GeckoViewIPProtection
  );
}

function buildStateResponse(lastError = null) {
  const manager = lazy.IPPProxyManager;
  const response = {
    serviceState: lazy.IPProtectionService.state,
    proxyState: manager.state,
  };

  if (lastError) {
    response.lastError = lastError;
  }

  const usage = manager.usageInfo;
  if (usage) {
    response.remaining = Number(usage.remaining);
    response.max = Number(usage.max);
    if (usage.reset) {
      response.resetTime = usage.reset.toString();
    }
  }

  return response;
}

function sendStateChanged() {
      let r = buildStateResponse();
    debug`sendStateChange: ${r}`;
  lazy.EventDispatcher.instance.sendRequest({
    ...r,
    type: "GeckoView:IPProtection:StateChanged",
  });
}

export const GeckoViewIPProtection = {
  handleEvent(event) {
      debug`handleEvent ${event}`;

    switch (event.type) {
      case "IPPProxyManager:StateChanged":
      case "IPPProxyManager:UsageChanged":
      case "IPProtectionService:StateChanged":
        sendStateChanged();
        break;
    }
  },

  onEvent(aEvent, aData, aCallback) {
    debug`onEvent ${aEvent}`;

    ensureInitialized();
    ensureListening();

    switch (aEvent) {
      case "GeckoView:IPProtection:GetState": {
        aCallback.onSuccess(buildStateResponse());
        break;
      }
      case "GeckoView:IPProtection:Activate": {
        lazy.IPPProxyManager.start()
          .then(({ error }) => {
              let r = buildStateResponse(error);
            debug`onEvent ${aEvent} ${error} ${r}`;
            aCallback.onSuccess(r);
          })
          .catch(err => {
            debug`onEvent ${aEvent} ${err}`;
            aCallback.onError(`Activation failed: ${err}`);
          });
        break;
      }
      case "GeckoView:IPProtection:Deactivate": {
        lazy.IPPProxyManager.stop()
          .then(() => {
            aCallback.onSuccess(buildStateResponse());
          })
          .catch(err => {
            aCallback.onError(`Deactivation failed: ${err}`);
          });
        break;
      }
      case "GeckoView:IPProtection:SetTokenProvider": {
        debug`onEvent ${aEvent} ${aData}`;

        lazy.GeckoViewIPPSignInWatcher.setTokenProvider(!!aData?.hasProvider);
        aCallback.onSuccess(buildStateResponse());
        break;
      }
    }
  },
};

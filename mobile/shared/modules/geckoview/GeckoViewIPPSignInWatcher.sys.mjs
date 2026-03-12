/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import { XPCOMUtils } from "resource://gre/modules/XPCOMUtils.sys.mjs";

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  EventDispatcher: "resource://gre/modules/Messaging.sys.mjs",
  GuardianClient:
    "moz-src:///toolkit/components/ipprotection/GuardianClient.sys.mjs",
  IPPSignInWatcher:
    "moz-src:///toolkit/components/ipprotection/IPPSignInWatcher.sys.mjs",
  IPProtectionService:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
});

const gvConfig = {
  getToken: async (_abortSignal = null) => {
    const response = await lazy.EventDispatcher.instance.sendRequestForResult({
      type: "GeckoView:IPProtection:GetToken",
    });
    const token = response?.token;
    if (!token) {
      return null;
    }
    return {
      token,
      [Symbol.dispose]() {},
    };
  },
  guardianEndpoint: "",
  fxaOrigin: "",
};
XPCOMUtils.defineLazyPreferenceGetter(
  gvConfig,
  "guardianEndpoint",
  "browser.ipProtection.guardian.endpoint",
  "https://vpn.mozilla.org"
);
XPCOMUtils.defineLazyPreferenceGetter(
  gvConfig,
  "fxaOrigin",
  "identity.fxaccounts.remote.root"
);

/**
 * GeckoView implementation of sign-in state. Starts not-signed-in.
 * Registers itself as the backing implementation of the IPPSignInWatcher proxy.
 * The embedding app calls setTokenProvider(true) to signal authentication.
 */
class GeckoViewIPPSignInWatcherImpl extends EventTarget {
  #signedIn = false;
  #guardianClient = null;

  get isSignedIn() {
    return this.#signedIn;
  }

  get guardianClient() {
    return this.#guardianClient;
  }

  init() {
    lazy.IPPSignInWatcher.setImplementation(this);
  }

  initOnStartupCompleted() {}

  uninit() {
    this.#signedIn = false;
    this.#guardianClient = null;
  }

  setTokenProvider(hasProvider) {
    this.#signedIn = hasProvider;
    this.#guardianClient = hasProvider ? new lazy.GuardianClient(gvConfig) : null;
    lazy.IPProtectionService.updateState();
    this.dispatchEvent(
      new CustomEvent("IPPSignInWatcher:StateChanged", {
        bubbles: true,
        composed: true,
      })
    );
  }
}

export const GeckoViewIPPSignInWatcher = new GeckoViewIPPSignInWatcherImpl();

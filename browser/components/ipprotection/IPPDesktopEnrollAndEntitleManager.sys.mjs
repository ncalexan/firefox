/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

const lazy = {};

ChromeUtils.defineESModuleGetters(lazy, {
  IPPEnrollAndEntitleManager:
    "moz-src:///toolkit/components/ipprotection/IPPEnrollAndEntitleManager.sys.mjs",
  IPPStartupCache:
    "moz-src:///toolkit/components/ipprotection/IPPStartupCache.sys.mjs",
  IPProtectionService:
    "moz-src:///toolkit/components/ipprotection/IPProtectionService.sys.mjs",
  IPPSignInWatcher:
    "moz-src:///toolkit/components/ipprotection/IPPSignInWatcher.sys.mjs",
});

const LOG_PREF = "browser.ipProtection.log";

ChromeUtils.defineLazyGetter(lazy, "logConsole", function () {
  return console.createInstance({
    prefix: "IPPEnrollAndEntitleManager",
    maxLogLevel: Services.prefs.getBoolPref(LOG_PREF, false) ? "Debug" : "Warn",
  });
});

/**
 * Desktop implementation that manages enrollment and entitlement.
 * Registers itself as the backing implementation of the
 * IPPEnrollAndEntitleManager proxy.
 */
class IPPDesktopEnrollAndEntitleManagerImpl extends EventTarget {
  #entitlement = null;

  #enrollingPromise = null;
  #entitlementPromise = null;

  constructor() {
    super();

    this.handleEvent = this.#handleEvent.bind(this);
  }

  init() {
    lazy.IPPEnrollAndEntitleManager.setImplementation(this);

    this.#entitlement = lazy.IPPStartupCache.entitlement;

    lazy.IPPSignInWatcher.addEventListener(
      "IPPSignInWatcher:StateChanged",
      this.handleEvent
    );
  }

  initOnStartupCompleted() {
    if (!lazy.IPPSignInWatcher.isSignedIn) {
      return;
    }
    this.updateEntitlement();
  }

  uninit() {
    lazy.IPPSignInWatcher.removeEventListener(
      "IPPSignInWatcher:StateChanged",
      this.handleEvent
    );

    this.#entitlement = null;
  }

  #handleEvent(_event) {
    if (!lazy.IPPSignInWatcher.isSignedIn) {
      this.#setEntitlement(null);
      return;
    }
    this.updateEntitlement();
  }

  async updateEntitlement(forceRefetch = false) {
    if (this.#entitlementPromise) {
      return this.#entitlementPromise;
    }

    if (this.#enrollingPromise) {
      await this.#enrollingPromise;
    }

    let deferred = Promise.withResolvers();
    this.#entitlementPromise = deferred.promise;

    const entitled = await this.#entitle(forceRefetch);
    deferred.resolve(entitled);

    this.#entitlementPromise = null;
    return entitled;
  }

  async maybeEnrollAndEntitle(abortSignal = null) {
    if (this.#enrollingPromise) {
      return this.#enrollingPromise;
    }

    let deferred = Promise.withResolvers();
    this.#enrollingPromise = deferred.promise;

    const enrolledAndEntitled = await this.#enrollAndEntitle(abortSignal);
    deferred.resolve(enrolledAndEntitled);
    this.#enrollingPromise = null;

    return enrolledAndEntitled;
  }

  async #enrollAndEntitle(abortSignal = null) {
    if (this.#entitlement) {
      return { isEnrolledAndEntitled: true };
    }

    const { enrollment, error: enrollmentError } =
      await IPPDesktopEnrollAndEntitleManagerImpl.#enroll(abortSignal);

    if (enrollmentError || !enrollment) {
      this.#setEntitlement(null);
      return { isEnrolledAndEntitled: false, error: enrollmentError };
    }

    const { entitlement, error: entitlementError } =
      await IPPDesktopEnrollAndEntitleManagerImpl.#getEntitlement();

    if (entitlementError || !entitlement) {
      this.#setEntitlement(null);
      return { isEnrolledAndEntitled: false, error: entitlementError };
    }

    this.#setEntitlement(entitlement);
    return { isEnrolledAndEntitled: true };
  }

  async #entitle(forceRefetch = false) {
    if (this.#entitlement && !forceRefetch) {
      return { isEntitled: true };
    }

    let isLinked =
      await IPPDesktopEnrollAndEntitleManagerImpl.#isLinkedToGuardian(
        !forceRefetch
      );

    if (!isLinked) {
      this.#setEntitlement(null);
      return { isEntitled: false };
    }

    if (this.#enrollingPromise) {
      return { isEntitled: false };
    }

    let { entitlement, error } =
      await IPPDesktopEnrollAndEntitleManagerImpl.#getEntitlement();

    if (error || !entitlement) {
      this.#setEntitlement(null);
      return { isEntitled: false, error };
    }

    this.#setEntitlement(entitlement);
    return { isEntitled: true };
  }

  static async #enroll(abortSignal = null) {
    try {
      const enrollment = await lazy.IPProtectionService.guardian.enroll(
        "alpha",
        abortSignal
      );
      if (!enrollment?.ok) {
        return { enrollment: null, error: enrollment?.error };
      }
    } catch (error) {
      return { enrollment: null, error: error?.message };
    }
    return { enrollment: true };
  }

  static async #isLinkedToGuardian(useCache = true) {
    try {
      let isLinked = await lazy.IPProtectionService.guardian.isLinkedToGuardian(
        /* only cache: */ useCache
      );

      return isLinked;
    } catch (_) {
      return false;
    }
  }

  static async #getEntitlement() {
    try {
      const { status, entitlement, error } =
        await lazy.IPProtectionService.guardian.fetchUserInfo();
      lazy.logConsole.debug("Entitlement:", { status, entitlement, error });

      if (error || !entitlement || status != 200) {
        return { entitlement: null, error: error || `Status: ${status}` };
      }

      return { entitlement };
    } catch (error) {
      return { entitlement: null, error: error.message };
    }
  }

  #setEntitlement(entitlement) {
    this.#entitlement = entitlement;
    lazy.IPPStartupCache.storeEntitlement(this.#entitlement);

    lazy.IPProtectionService.updateState();

    this.dispatchEvent(
      new CustomEvent("IPPEnrollAndEntitleManager:StateChanged", {
        bubbles: true,
        composed: true,
      })
    );
  }

  get isEnrolledAndEntitled() {
    return !!this.#entitlement;
  }

  get hasUpgraded() {
    return this.#entitlement?.subscribed;
  }

  get isAlpha() {
    return (
      !this.#entitlement?.autostart &&
      !this.#entitlement?.website_inclusion &&
      !this.#entitlement?.location_controls
    );
  }

  get isEnrolling() {
    return !!this.#enrollingPromise;
  }

  async refetchEntitlement() {
    await this.updateEntitlement(true);
  }

  resetEntitlement() {
    this.#setEntitlement(null);
  }
}

const IPPDesktopEnrollAndEntitleManager =
  new IPPDesktopEnrollAndEntitleManagerImpl();

export { IPPDesktopEnrollAndEntitleManager };

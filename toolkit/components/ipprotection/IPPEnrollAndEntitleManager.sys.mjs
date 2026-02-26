/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Proxy holder for enrollment and entitlement state. Platform-specific
 * implementations (e.g. the Desktop IPPEnrollAndEntitleManager) register
 * themselves via setImplementation(); all property access is transparently
 * forwarded.
 *
 * The default implementation assumes the user is always enrolled and
 * entitled, which is the correct behaviour for GeckoView / Android where
 * enrollment is handled outside Gecko.
 */

let _impl = null;

class IPPEnrollAndEntitleManagerDefault extends EventTarget {
  get isEnrolledAndEntitled() {
    return true;
  }

  get hasUpgraded() {
    return false;
  }

  get isAlpha() {
    return true;
  }

  get isEnrolling() {
    return false;
  }

  init() {}
  initOnStartupCompleted() {}
  uninit() {}

  async updateEntitlement() {
    return { isEntitled: true };
  }

  async maybeEnrollAndEntitle() {
    return { isEnrolledAndEntitled: true };
  }

  async refetchEntitlement() {}

  resetEntitlement() {}
}

const _default = new IPPEnrollAndEntitleManagerDefault();

const IPPEnrollAndEntitleManager = new Proxy(_default, {
  get(target, prop, _receiver) {
    if (prop === "setImplementation") {
      return impl => {
        _impl = impl;
      };
    }
    const obj = _impl ?? target;
    const val = Reflect.get(obj, prop, obj);
    return typeof val === "function" ? val.bind(obj) : val;
  },
  set(target, prop, value) {
    const obj = _impl ?? target;
    return Reflect.set(obj, prop, value, obj);
  },
  has(target, prop) {
    const obj = _impl ?? target;
    return Reflect.has(obj, prop);
  },
  getOwnPropertyDescriptor(target, prop) {
    const obj = _impl ?? target;
    return Reflect.getOwnPropertyDescriptor(obj, prop);
  },
  defineProperty(target, prop, descriptor) {
    const obj = _impl ?? target;
    return Reflect.defineProperty(obj, prop, descriptor);
  },
  ownKeys(target) {
    const obj = _impl ?? target;
    return Reflect.ownKeys(obj);
  },
});

export { IPPEnrollAndEntitleManager };

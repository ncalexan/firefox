/* -*- Mode: Java; c-basic-offset: 4; tab-width: 20; indent-tabs-mode: nil; -*-
 * vim: ts=4 sw=4 expandtab:
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

package org.mozilla.geckoview;

import android.util.Log;

import androidx.annotation.IntDef;
import androidx.annotation.NonNull;
import androidx.annotation.Nullable;
import androidx.annotation.UiThread;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import org.mozilla.gecko.EventDispatcher;
import org.mozilla.gecko.util.BundleEventListener;
import org.mozilla.gecko.util.EventCallback;
import org.mozilla.gecko.util.GeckoBundle;
import org.mozilla.gecko.util.ThreadUtils;

/** Controller for managing IP protection state. */
public class IPProtectionController {

  public static final String LOG_TAG = "IPProtectionController";

  /** The service has not been initialized yet. */
  public static final int SERVICE_STATE_UNINITIALIZED = 0;

  /** The user is not eligible or still not signed in. */
  public static final int SERVICE_STATE_UNAVAILABLE = 1;

  /** The user is signed out but eligible. */
  public static final int SERVICE_STATE_UNAUTHENTICATED = 2;

  /** The service is ready to be activated. */
  public static final int SERVICE_STATE_READY = 3;

  /** The possible States of the IPProtectionState */
  @Retention(RetentionPolicy.SOURCE)
  @IntDef({
    SERVICE_STATE_UNINITIALIZED,
    SERVICE_STATE_UNAVAILABLE,
    SERVICE_STATE_UNAUTHENTICATED,
    SERVICE_STATE_READY
  })
  public @interface ServiceState {}

  /** The proxy is not ready. */
  public static final int PROXY_STATE_NOT_READY = 0;

  /** The proxy is ready to be activated. */
  public static final int PROXY_STATE_READY = 1;

  /** The proxy is in the process of activating. */
  public static final int PROXY_STATE_ACTIVATING = 2;

  /** The proxy is active. */
  public static final int PROXY_STATE_ACTIVE = 3;

  /** The proxy encountered an error. */
  public static final int PROXY_STATE_ERROR = 4;

  /** The proxy is paused (e.g. bandwidth limit reached). */
  public static final int PROXY_STATE_PAUSED = 5;

  /** The Possible States of the IPProxyManager */
  @Retention(RetentionPolicy.SOURCE)
  @IntDef({
    PROXY_STATE_NOT_READY,
    PROXY_STATE_READY,
    PROXY_STATE_ACTIVATING,
    PROXY_STATE_ACTIVE,
    PROXY_STATE_ERROR,
    PROXY_STATE_PAUSED
  })
  public @interface ProxyState {}

  private static @ServiceState int parseServiceState(final @NonNull String state) {
    switch (state) {
      case "unavailable":
        return SERVICE_STATE_UNAVAILABLE;
      case "unauthenticated":
        return SERVICE_STATE_UNAUTHENTICATED;
      case "ready":
        return SERVICE_STATE_READY;
      default:
        return SERVICE_STATE_UNINITIALIZED;
    }
  }

  private static @ProxyState int parseProxyState(final @NonNull String state) {
    switch (state) {
      case "ready":
        return PROXY_STATE_READY;
      case "activating":
        return PROXY_STATE_ACTIVATING;
      case "active":
        return PROXY_STATE_ACTIVE;
      case "error":
        return PROXY_STATE_ERROR;
      case "paused":
        return PROXY_STATE_PAUSED;
      default:
        return PROXY_STATE_NOT_READY;
    }
  }

  /** Holds information about the current IP protection state and usage. */
  public static class StateInfo {
    /** The current service state. One of the {@link ServiceState} constants. */
    public final @ServiceState int serviceState;

    /** The current proxy state. One of the {@link ProxyState} constants. */
    public final @ProxyState int proxyState;

    /** The last error string, if {@link #proxyState} is {@link #PROXY_STATE_ERROR}. */
    public final @Nullable String lastError;

    /** Remaining usage allowance, or -1 if unavailable. */
    public final int remaining;

    /** Maximum usage allowance, or -1 if unavailable. */
    public final int max;

    /** The time when usage resets, as an ISO 8601 string, or null if unavailable. */
    public final @Nullable String resetTime;

    /** Constructs an Empty Info */
    protected StateInfo() {
      serviceState = SERVICE_STATE_UNINITIALIZED;
      proxyState = PROXY_STATE_NOT_READY;
      lastError = null;
      remaining = -1;
      max = -1;
      resetTime = null;
    }

    /* package */ StateInfo(final @NonNull GeckoBundle bundle) {
      serviceState = parseServiceState(bundle.getString("serviceState", ""));
      proxyState = parseProxyState(bundle.getString("proxyState", ""));
      lastError = bundle.getString("lastError");
      remaining = bundle.getInt("remaining", -1);
      max = bundle.getInt("max", -1);
      resetTime = bundle.getString("resetTime");
    }

    @NonNull
    @Override
    public String toString() {
      return "serviceState=" + serviceState + " proxyState=" + proxyState + " lastError=" + lastError;
    }
  }

  /**
   * Provides a fresh authentication token on demand. Called each time the JS layer needs to make
   * a Guardian API request, so tokens are never cached in the browser process.
   */
  public interface TokenProvider {
    /**
     * Returns a valid authentication token.
     *
     * @return A {@link GeckoResult} that resolves to the token string, or null if unavailable.
     */
    @UiThread
    @NonNull
    GeckoResult<String> getToken();
  }

  /** Delegate for receiving IP protection state notifications. */
  public interface Delegate {
    /**
     * Called when the IP protection state changes.
     *
     * @param info The current state information.
     */
    @UiThread
    default void onStateChanged(final @NonNull StateInfo info) {}
  }

  private Delegate mDelegate;
  private TokenProvider mTokenProvider;
  private final BundleEventListener mEventListener;

  /* package */ IPProtectionController() {
    mEventListener = new EventListener();
    EventDispatcher.getInstance()
        .registerUiThreadListener(
            mEventListener,
            "GeckoView:IPProtection:StateChanged",
            "GeckoView:IPProtection:GetToken");
  }

  /**
   * Sets the {@link Delegate} for this instance.
   *
   * @param delegate The {@link Delegate} instance.
   */
  @UiThread
  public void setDelegate(final @Nullable Delegate delegate) {
    ThreadUtils.assertOnUiThread();
    mDelegate = delegate;
  }

  /**
   * Gets the {@link Delegate} for this instance.
   *
   * @return The {@link Delegate} instance.
   */
  @UiThread
  @Nullable
  public Delegate getDelegate() {
    ThreadUtils.assertOnUiThread();
    return mDelegate;
  }

  /**
   * Sets the {@link TokenProvider} used to supply authentication tokens to the IP protection
   * service. Pass {@code null} to sign out.
   *
   * @param provider The {@link TokenProvider}, or {@code null} to sign out.
   * @return A {@link GeckoResult} that resolves to the updated {@link StateInfo}.
   */
  @UiThread
  public @NonNull GeckoResult<StateInfo> setTokenProvider(final @Nullable TokenProvider provider) {
    Log.e(LOG_TAG, "setTokenProvider");
    ThreadUtils.assertOnUiThread();
    mTokenProvider = provider;
    final GeckoBundle bundle = new GeckoBundle(1);
    bundle.putBoolean("hasProvider", provider != null);
    return EventDispatcher.getInstance()
        .queryBundle("GeckoView:IPProtection:SetTokenProvider", bundle)
        .map(StateInfo::new);
  }

  /**
   * Gets the current IP protection state.
   *
   * @return A {@link GeckoResult} that resolves to a {@link StateInfo} containing the current
   *     state.
   */
  @UiThread
  public @NonNull GeckoResult<StateInfo> getState() {
    ThreadUtils.assertOnUiThread();
    return EventDispatcher.getInstance()
        .queryBundle("GeckoView:IPProtection:GetState", null)
        .map(StateInfo::new)
            .map(stateInfo -> {
              Log.e(LOG_TAG, "GeckoView:IPProtection:GetState: " + stateInfo);
              return stateInfo;
            });
  }

  /**
   * Activates the IP proxy.
   *
   * @return A {@link GeckoResult} that resolves to the updated {@link StateInfo} on success.
   */
  @UiThread
  public @NonNull GeckoResult<StateInfo> activate() {
    ThreadUtils.assertOnUiThread();
    return EventDispatcher.getInstance()
        .queryBundle("GeckoView:IPProtection:Activate", null)
        .map(StateInfo::new)
            .map(stateInfo -> {
              Log.e(LOG_TAG, "GeckoView:IPProtection:Activate: " + stateInfo);
              return stateInfo;
            });
  }

  /**
   * Deactivates the IP proxy.
   *
   * @return A {@link GeckoResult} that resolves to the updated {@link StateInfo} on success.
   */
  @UiThread
  public @NonNull GeckoResult<StateInfo> deactivate() {
    ThreadUtils.assertOnUiThread();
    return EventDispatcher.getInstance()
        .queryBundle("GeckoView:IPProtection:Deactivate", null)
        .map(StateInfo::new)
            .map(stateInfo -> {
              Log.e(LOG_TAG, "GeckoView:IPProtection:Activate: " + stateInfo);
              return stateInfo;
            });
  }

  private class EventListener implements BundleEventListener {
    @Override
    public void handleMessage(
        final String event, final GeckoBundle message, final EventCallback callback) {
      if ("GeckoView:IPProtection:StateChanged".equals(event)) {
        Log.e(LOG_TAG, "GeckoView:IPProtection:StateChanged: " + event + " (delegate " + ((mDelegate != null) ? "exists)" : "does not exist)"));
        if (mDelegate != null) {
          mDelegate.onStateChanged(new StateInfo(message));
        }
      } else if ("GeckoView:IPProtection:GetToken".equals(event)) {
        if (mTokenProvider == null) {
          Log.e(LOG_TAG, "GeckoView:IPProtection:GetToken: " + event + ": no token provider");
          callback.sendError("No token provider");
          return;
        }
        callback.resolveTo(
            mTokenProvider
                .getToken()
                .map(
                    token -> {
                      Log.e(LOG_TAG, "GeckoView:IPProtection:GetToken: " + event + ": token: " + token);
                      final GeckoBundle result = new GeckoBundle(1);
                      result.putString("token", token);
                      return result;
                    }));
      }
    }
  }
}

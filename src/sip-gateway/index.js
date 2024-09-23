"use strict";

import adapter from "webrtc-adapter";

let configRTCP;
Sipgateway.sessions = {};
Sipgateway.isExtensionEnabled = function () {
  if (navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia) {
    return true;
  }
  if (window.navigator.userAgent.match("Chrome")) {
    var chromever = parseInt(
      window.navigator.userAgent.match(/Chrome\/(.*) /)[1],
      10
    );
    var maxver = 33;
    if (window.navigator.userAgent.match("Linux")) maxver = 35;
    if (chromever >= 26 && chromever <= maxver) {
      return true;
    }
    return Sipgateway.extension.isInstalled();
  } else {
    return true;
  }
};
var defaultExtension = {
  extensionId: "hapfgfdkleiggjjpfpenajgdnfckjpaj",
  isInstalled: function () {
    return document.querySelector("#janus-extension-installed") !== null;
  },
  getScreen: function (callback) {
    var pending = window.setTimeout(function () {
      var error = new Error("NavigatorUserMediaError");
      error.name =
        'The required Chrome extension is not installed: click <a href="#">here</a> to install it. (NOTE: this will need you to refresh the page)';
      return callback(error);
    }, 1000);
    this.cache[pending] = callback;
    window.postMessage({ type: "janusGetScreen", id: pending }, "*");
  },
  init: function () {
    var cache = {};
    this.cache = cache;

    window.addEventListener("message", function (event) {
      if (event.origin != window.location.origin) return;
      if (event.data.type == "janusGotScreen" && cache[event.data.id]) {
        var callback = cache[event.data.id];
        delete cache[event.data.id];
        if (event.data.sourceId === "") {
          var error = new Error("NavigatorUserMediaError");
          error.name = "You cancelled the request for permission, giving up...";
          callback(error);
        } else {
          callback(null, event.data.sourceId);
        }
      } else if (event.data.type == "janusGetScreenPending") {
        console.log("clearing ", event.data.id);
        window.clearTimeout(event.data.id);
      }
    });
  },
};
Sipgateway.useDefaultDependencies = function (deps) {
  var f = (deps && deps.fetch) || fetch;
  var p = (deps && deps.Promise) || Promise;
  var socketCls = (deps && deps.WebSocket) || WebSocket;
  return {
    newWebSocket: function (server, proto) {
      return new socketCls(server, proto);
    },
    extension: (deps && deps.extension) || defaultExtension,
    isArray: function (arr) {
      return Array.isArray(arr);
    },
    webRTCAdapter: (deps && deps.adapter) || adapter,
    httpAPICall: function (url, options) {
      var fetchOptions = {
        method: options.verb,
        headers: {
          Accept: "application/json, text/plain, */*",
        },
        cache: "no-cache",
      };
      if (options.verb === "POST") {
        fetchOptions.headers["Content-Type"] = "application/json";
      }
      if (options.withCredentials !== undefined) {
        fetchOptions.credentials =
          options.withCredentials === true
            ? "include"
            : options.withCredentials
            ? options.withCredentials
            : "omit";
      }
      if (options.body) {
        fetchOptions.body = JSON.stringify(options.body);
      }
      var fetching = f(url, fetchOptions).catch(function (error) {
        return p.reject({
          message: "Probably a network error, is the server down?",
          error: error,
        });
      });
      /*
       * fetch() does not natively support timeouts.
       * Work around this by starting a timeout manually, and racing it agains the fetch() to see which thing resolves first.
       */
      if (options.timeout) {
        var timeout = new p(function (resolve, reject) {
          var timerId = setTimeout(function () {
            clearTimeout(timerId);
            return reject({
              message: "Request timed out",
              timeout: options.timeout,
            });
          }, options.timeout);
        });
        fetching = p.race([fetching, timeout]);
      }
      fetching
        .then(function (response) {
          if (response.ok) {
            if (typeof options.success === typeof Sipgateway.noop) {
              return response.json().then(
                function (parsed) {
                  try {
                    options.success(parsed);
                  } catch (error) {
                    Sipgateway.error(
                      "Unhandled httpAPICall success callback error",
                      error
                    );
                  }
                },
                function (error) {
                  return p.reject({
                    message: "Failed to parse response body",
                    error: error,
                    response: response,
                  });
                }
              );
            }
          } else {
            return p.reject({ message: "API call failed", response: response });
          }
        })
        .catch(function (error) {
          if (typeof options.error === typeof Sipgateway.noop) {
            options.error(error.message || "<< internal error >>", error);
          }
        });
      return fetching;
    },
  };
};
Sipgateway.useOldDependencies = function (deps) {
  var jq = (deps && deps.jQuery) || jQuery;
  var socketCls = (deps && deps.WebSocket) || WebSocket;
  return {
    newWebSocket: function (server, proto) {
      return new socketCls(server, proto);
    },
    isArray: function (arr) {
      return jq.isArray(arr);
    },
    extension: (deps && deps.extension) || defaultExtension,
    webRTCAdapter: (deps && deps.adapter) || adapter,
    httpAPICall: function (url, options) {
      var payload =
        options.body !== undefined
          ? {
              contentType: "application/json",
              data: JSON.stringify(options.body),
            }
          : {};
      var credentials =
        options.withCredentials !== undefined
          ? { xhrFields: { withCredentials: options.withCredentials } }
          : {};
      return jq.ajax(
        jq.extend(payload, credentials, {
          url: url,
          type: options.verb,
          cache: false,
          dataType: "json",
          async: options.async,
          timeout: options.timeout,
          success: function (result) {
            if (typeof options.success === typeof Sipgateway.noop) {
              options.success(result);
            }
          },
          error: function (xhr, status, err) {
            if (typeof options.error === typeof Sipgateway.noop) {
              options.error(status, err);
            }
          },
        })
      );
    },
  };
};
Sipgateway.noop = function () {};
Sipgateway.dataChanDefaultLabel = "JanusDataChannel";
Sipgateway.endOfCandidates = null;
Sipgateway.stopAllTracks = function (stream) {
  try {
    var tracks = stream.getTracks();
    for (var mst of tracks) {
      Sipgateway.log(mst);
      if (mst) {
        mst.stop();
      }
    }
  } catch (e) {}
};
Sipgateway.init = function (options) {
  options = options || {};
  options.callback =
    typeof options.callback == "function" ? options.callback : Sipgateway.noop;
  if (Sipgateway.initDone) {
    options.callback();
  } else {
    if (typeof console.log == "undefined") {
      console.log = function () {};
    }

    Sipgateway.trace = Sipgateway.noop;
    Sipgateway.debug = Sipgateway.noop;
    Sipgateway.vdebug = Sipgateway.noop;
    Sipgateway.log = Sipgateway.noop;
    Sipgateway.warn = Sipgateway.noop;
    Sipgateway.error = Sipgateway.noop;
    if (options.debug === true || options.debug === "all") {
      Sipgateway.trace = console.trace.bind(console);
      Sipgateway.debug = console.debug.bind(console);
      Sipgateway.vdebug = console.debug.bind(console);
      Sipgateway.log = console.log.bind(console);
      Sipgateway.warn = console.warn.bind(console);
      Sipgateway.error = console.error.bind(console);
    } else if (Array.isArray(options.debug)) {
      for (var d of options.debug) {
        switch (d) {
          case "trace":
            Sipgateway.trace = console.trace.bind(console);
            break;
          case "debug":
            Sipgateway.debug = console.debug.bind(console);
            break;
          case "vdebug":
            Sipgateway.vdebug = console.debug.bind(console);
            break;
          case "log":
            Sipgateway.log = console.log.bind(console);
            break;
          case "warn":
            Sipgateway.warn = console.warn.bind(console);
            break;
          case "error":
            Sipgateway.error = console.error.bind(console);
            break;
          default:
            console.error(
              "Unknown debugging option '" +
                d +
                "' (supported: 'trace', 'debug', 'vdebug', 'log', warn', 'error')"
            );
            break;
        }
      }
    }
    Sipgateway.log("Initializing library");
    var usedDependencies =
      options.dependencies || Sipgateway.useDefaultDependencies();
    Sipgateway.isArray = usedDependencies.isArray;
    Sipgateway.webRTCAdapter = usedDependencies.webRTCAdapter;
    Sipgateway.httpAPICall = usedDependencies.httpAPICall;
    Sipgateway.newWebSocket = usedDependencies.newWebSocket;
    Sipgateway.extension = usedDependencies.extension;
    Sipgateway.extension.init();

    Sipgateway.listDevices = function (callback, config) {
      callback = typeof callback == "function" ? callback : Sipgateway.noop;
      if (config == null) config = { audio: true, video: true };
      if (Sipgateway.isGetUserMediaAvailable()) {
        navigator.mediaDevices
          .getUserMedia(config)
          .then(function (stream) {
            navigator.mediaDevices.enumerateDevices().then(function (devices) {
              Sipgateway.debug(devices);
              callback(devices);

              Sipgateway.stopAllTracks(stream);
            });
          })
          .catch(function (err) {
            Sipgateway.error(err);
            callback([]);
          });
      } else {
        Sipgateway.warn("navigator.mediaDevices unavailable");
        callback([]);
      }
    };

    Sipgateway.attachMediaStream = function (element, stream) {
      try {
        element.srcObject = stream;
      } catch (e) {
        try {
          element.src = URL.createObjectURL(stream);
        } catch (e) {
          Sipgateway.error("Error attaching stream to element");
        }
      }
    };
    Sipgateway.reattachMediaStream = function (to, from) {
      try {
        to.srcObject = from.srcObject;
      } catch (e) {
        try {
          to.src = from.src;
        } catch (e) {
          Sipgateway.error("Error reattaching stream to element");
        }
      }
    };

    var iOS = ["iPad", "iPhone", "iPod"].indexOf(navigator.platform) >= 0;
    var eventName = iOS ? "pagehide" : "beforeunload";
    var oldOBF = window["on" + eventName];
    window.addEventListener(eventName, function () {
      Sipgateway.log("Closing window");
      for (var s in Sipgateway.sessions) {
        if (Sipgateway.sessions[s] && Sipgateway.sessions[s].destroyOnUnload) {
          Sipgateway.log("Destroying session " + s);
          Sipgateway.sessions[s].destroy({
            unload: true,
            notifyDestroyed: false,
          });
        }
      }
      if (oldOBF && typeof oldOBF == "function") {
        oldOBF();
      }
    });

    Sipgateway.safariVp8 = false;
    if (
      Sipgateway.webRTCAdapter.browserDetails.browser === "safari" &&
      Sipgateway.webRTCAdapter.browserDetails.version >= 605
    ) {
      if (
        RTCRtpSender &&
        RTCRtpSender.getCapabilities &&
        RTCRtpSender.getCapabilities("video") &&
        RTCRtpSender.getCapabilities("video").codecs &&
        RTCRtpSender.getCapabilities("video").codecs.length
      ) {
        for (var codec of RTCRtpSender.getCapabilities("video").codecs) {
          if (
            codec &&
            codec.mimeType &&
            codec.mimeType.toLowerCase() === "video/vp8"
          ) {
            Sipgateway.safariVp8 = true;
            break;
          }
        }
        if (Sipgateway.safariVp8) {
          Sipgateway.log("This version of Safari supports VP8");
        } else {
          Sipgateway.warn(
            "This version of Safari does NOT support VP8: if you're using a Technology Preview, " +
              "try enabling the 'WebRTC VP8 codec' setting in the 'Experimental Features' Develop menu"
          );
        }
      } else {
        var testpc = new RTCPeerConnection({});
        testpc
          .createOffer({ offerToReceiveVideo: true })
          .then(function (offer) {
            Sipgateway.safariVp8 = offer.sdp.indexOf("VP8") !== -1;
            if (Sipgateway.safariVp8) {
              Sipgateway.log("This version of Safari supports VP8");
            } else {
              Sipgateway.warn(
                "This version of Safari does NOT support VP8: if you're using a Technology Preview, " +
                  "try enabling the 'WebRTC VP8 codec' setting in the 'Experimental Features' Develop menu"
              );
            }
            testpc.close();
            testpc = null;
          });
      }
    }

    Sipgateway.unifiedPlan = false;
    if (
      Sipgateway.webRTCAdapter.browserDetails.browser === "firefox" &&
      Sipgateway.webRTCAdapter.browserDetails.version >= 59
    ) {
      Sipgateway.unifiedPlan = true;
    } else if (
      Sipgateway.webRTCAdapter.browserDetails.browser === "chrome" &&
      Sipgateway.webRTCAdapter.browserDetails.version >= 72
    ) {
      Sipgateway.unifiedPlan = true;
    } else if (
      !window.RTCRtpTransceiver ||
      !("currentDirection" in RTCRtpTransceiver.prototype)
    ) {
      Sipgateway.unifiedPlan = false;
    } else {
      var tempPc = new RTCPeerConnection();
      try {
        tempPc.addTransceiver("audio");
        Sipgateway.unifiedPlan = true;
      } catch (e) {}
      tempPc.close();
    }
    Sipgateway.initDone = true;
    options.callback();
  }
};
Sipgateway.isWebrtcSupported = function () {
  return !!window.RTCPeerConnection;
};
Sipgateway.isGetUserMediaAvailable = function () {
  return navigator.mediaDevices && navigator.mediaDevices.getUserMedia;
};
Sipgateway.randomString = function (len) {
  var charSet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  var randomString = "";
  for (var i = 0; i < len; i++) {
    var randomPoz = Math.floor(Math.random() * charSet.length);
    randomString += charSet.substring(randomPoz, randomPoz + 1);
  }
  return randomString;
};
function Sipgateway(gatewayCallbacks) {
  gatewayCallbacks = gatewayCallbacks || {};
  gatewayCallbacks.success =
    typeof gatewayCallbacks.success == "function"
      ? gatewayCallbacks.success
      : Sipgateway.noop;
  gatewayCallbacks.error =
    typeof gatewayCallbacks.error == "function"
      ? gatewayCallbacks.error
      : Sipgateway.noop;
  gatewayCallbacks.destroyed =
    typeof gatewayCallbacks.destroyed == "function"
      ? gatewayCallbacks.destroyed
      : Sipgateway.noop;
  if (!Sipgateway.initDone) {
    gatewayCallbacks.error("Library not initialized");
    return {};
  }
  if (!Sipgateway.isWebrtcSupported()) {
    gatewayCallbacks.error("WebRTC not supported by this browser");
    return {};
  }
  Sipgateway.log("Library initialized: " + Sipgateway.initDone);
  if (!gatewayCallbacks.server) {
    gatewayCallbacks.error("Invalid server url");
    return {};
  }
  var websockets = false;
  var ws = null;
  var wsHandlers = {};
  var wsKeepaliveTimeoutId = null;
  var servers = null;
  var serversIndex = 0;
  var server = gatewayCallbacks.server;
  if (Sipgateway.isArray(server)) {
    Sipgateway.log(
      "Multiple servers provided (" +
        server.length +
        "), will use the first that works"
    );
    server = null;
    servers = gatewayCallbacks.server;
    Sipgateway.debug(servers);
  } else {
    if (server.indexOf("ws") === 0) {
      websockets = true;
      Sipgateway.log("Using WebSockets to contact Sipgateway: " + server);
    } else {
      websockets = false;
      Sipgateway.log("Using REST API to contact Sipgateway: " + server);
    }
  }
  var iceServers = gatewayCallbacks.iceServers || [
    { urls: "stun:stun.l.google.com:19302" },
  ];
  var iceTransportPolicy = gatewayCallbacks.iceTransportPolicy;
  var bundlePolicy = gatewayCallbacks.bundlePolicy;

  var ipv6Support = gatewayCallbacks.ipv6 === true;

  var withCredentials = false;
  if (
    gatewayCallbacks.withCredentials !== undefined &&
    gatewayCallbacks.withCredentials !== null
  )
    withCredentials = gatewayCallbacks.withCredentials === true;

  var maxev = 10;
  if (
    gatewayCallbacks.max_poll_events !== undefined &&
    gatewayCallbacks.max_poll_events !== null
  )
    maxev = gatewayCallbacks.max_poll_events;
  if (maxev < 1) maxev = 1;

  var token = null;
  if (gatewayCallbacks.token !== undefined && gatewayCallbacks.token !== null)
    token = gatewayCallbacks.token;

  var apisecret = null;
  if (
    gatewayCallbacks.apisecret !== undefined &&
    gatewayCallbacks.apisecret !== null
  )
    apisecret = gatewayCallbacks.apisecret;

  this.destroyOnUnload = true;
  if (
    gatewayCallbacks.destroyOnUnload !== undefined &&
    gatewayCallbacks.destroyOnUnload !== null
  )
    this.destroyOnUnload = gatewayCallbacks.destroyOnUnload === true;

  var keepAlivePeriod = 25000;
  if (
    gatewayCallbacks.keepAlivePeriod !== undefined &&
    gatewayCallbacks.keepAlivePeriod !== null
  )
    keepAlivePeriod = gatewayCallbacks.keepAlivePeriod;
  if (isNaN(keepAlivePeriod)) keepAlivePeriod = 25000;
  var longPollTimeout = 60000;
  if (
    gatewayCallbacks.longPollTimeout !== undefined &&
    gatewayCallbacks.longPollTimeout !== null
  )
    longPollTimeout = gatewayCallbacks.longPollTimeout;
  if (isNaN(longPollTimeout)) longPollTimeout = 60000;

  function getMaxBitrates(simulcastMaxBitrates) {
    var maxBitrates = {
      high: 900000,
      medium: 300000,
      low: 100000,
    };
    if (simulcastMaxBitrates !== undefined && simulcastMaxBitrates !== null) {
      if (simulcastMaxBitrates.high)
        maxBitrates.high = simulcastMaxBitrates.high;
      if (simulcastMaxBitrates.medium)
        maxBitrates.medium = simulcastMaxBitrates.medium;
      if (simulcastMaxBitrates.low) maxBitrates.low = simulcastMaxBitrates.low;
    }
    return maxBitrates;
  }
  var connected = false;
  var sessionId = null;
  var pluginHandles = {};
  var that = this;
  var retries = 0;
  var transactions = {};
  createSession(gatewayCallbacks);

  this.getServer = function () {
    return server;
  };
  this.isConnected = function () {
    return connected;
  };
  this.reconnect = function (callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    callbacks["reconnect"] = true;
    createSession(callbacks);
  };
  this.getSessionId = function () {
    return sessionId;
  };
  this.getInfo = function (callbacks) {
    getInfo(callbacks);
  };
  this.destroy = function (callbacks) {
    destroySession(callbacks);
  };
  this.attach = function (callbacks) {
    createHandle(callbacks);
  };
  function eventHandler() {
    if (sessionId == null) return;
    Sipgateway.debug("Long poll...");
    if (!connected) {
      Sipgateway.warn("Is the server down? (connected=false)");
      return;
    }
    var longpoll = server + "/" + sessionId + "?rid=" + new Date().getTime();
    if (maxev) longpoll = longpoll + "&maxev=" + maxev;
    if (token) longpoll = longpoll + "&token=" + encodeURIComponent(token);
    if (apisecret)
      longpoll = longpoll + "&apisecret=" + encodeURIComponent(apisecret);
    Sipgateway.httpAPICall(longpoll, {
      verb: "GET",
      withCredentials: withCredentials,
      success: handleEvent,
      timeout: longPollTimeout,
      error: function (textStatus, errorThrown) {
        Sipgateway.error(textStatus + ":", errorThrown);
        retries++;
        if (retries > 3) {
          connected = false;
          gatewayCallbacks.error("Lost connection to the server (is it down?)");
          return;
        }
        eventHandler();
      },
    });
  }

  function handleEvent(json, skipTimeout) {
    retries = 0;
    if (
      !websockets &&
      sessionId !== undefined &&
      sessionId !== null &&
      skipTimeout !== true
    )
      eventHandler();
    if (!websockets && Sipgateway.isArray(json)) {
      for (var i = 0; i < json.length; i++) {
        handleEvent(json[i], true);
      }
      return;
    }
    if (json["janus"] === "keepalive") {
      Sipgateway.vdebug("Got a keepalive on session " + sessionId);
      return;
    } else if (json["janus"] === "server_info") {
      Sipgateway.debug("Got info on the Sipgateway instance");
      Sipgateway.debug(json);
      const transaction = json["transaction"];
      if (transaction) {
        const reportSuccess = transactions[transaction];
        if (reportSuccess) reportSuccess(json);
        delete transactions[transaction];
      }
      return;
    } else if (json["janus"] === "ack") {
      Sipgateway.debug("Got an ack on session " + sessionId);
      Sipgateway.debug(json);
      const transaction = json["transaction"];
      if (transaction) {
        const reportSuccess = transactions[transaction];
        if (reportSuccess) reportSuccess(json);
        delete transactions[transaction];
      }
      return;
    } else if (json["janus"] === "success") {
      Sipgateway.debug("Got a success on session " + sessionId);
      Sipgateway.debug(json);
      const transaction = json["transaction"];
      if (transaction) {
        const reportSuccess = transactions[transaction];
        if (reportSuccess) reportSuccess(json);
        delete transactions[transaction];
      }
      return;
    } else if (json["janus"] === "trickle") {
      const sender = json["sender"];
      if (!sender) {
        Sipgateway.warn("Missing sender...");
        return;
      }
      const pluginHandle = pluginHandles[sender];
      if (!pluginHandle) {
        Sipgateway.debug("This handle is not attached to this session");
        return;
      }
      var candidate = json["candidate"];
      Sipgateway.debug("Got a trickled candidate on session " + sessionId);
      Sipgateway.debug(candidate);
      var config = pluginHandle.webrtcStuff;
      if (config.pc && config.remoteSdp) {
        Sipgateway.debug("Adding remote candidate:", candidate);
        if (!candidate || candidate.completed === true) {
          config.pc.addIceCandidate(Sipgateway.endOfCandidates);
        } else {
          config.pc.addIceCandidate(candidate);
        }
      } else {
        Sipgateway.debug(
          "We didn't do setRemoteDescription (trickle got here before the offer?), caching candidate"
        );
        if (!config.candidates) config.candidates = [];
        config.candidates.push(candidate);
        Sipgateway.debug(config.candidates);
      }
    } else if (json["janus"] === "webrtcup") {
      Sipgateway.debug("Got a webrtcup event on session " + sessionId);
      Sipgateway.debug(json);
      const sender = json["sender"];
      if (!sender) {
        Sipgateway.warn("Missing sender...");
        return;
      }
      const pluginHandle = pluginHandles[sender];
      if (!pluginHandle) {
        Sipgateway.debug("This handle is not attached to this session");
        return;
      }
      pluginHandle.webrtcState(true);
      return;
    } else if (json["janus"] === "hangup") {
      Sipgateway.debug("Got a hangup event on session " + sessionId);
      Sipgateway.debug(json);
      const sender = json["sender"];
      if (!sender) {
        Sipgateway.warn("Missing sender...");
        return;
      }
      const pluginHandle = pluginHandles[sender];
      if (!pluginHandle) {
        Sipgateway.debug("This handle is not attached to this session");
        return;
      }
      pluginHandle.webrtcState(false, json["reason"]);
      pluginHandle.hangup();
    } else if (json["janus"] === "detached") {
      Sipgateway.debug("Got a detached event on session " + sessionId);
      Sipgateway.debug(json);
      const sender = json["sender"];
      if (!sender) {
        Sipgateway.warn("Missing sender...");
        return;
      }
      const pluginHandle = pluginHandles[sender];
      if (!pluginHandle) {
        return;
      }
      pluginHandle.ondetached();
      pluginHandle.detach();
    } else if (json["janus"] === "media") {
      Sipgateway.debug("Got a media event on session " + sessionId);
      Sipgateway.debug(json);
      const sender = json["sender"];
      if (!sender) {
        Sipgateway.warn("Missing sender...");
        return;
      }
      const pluginHandle = pluginHandles[sender];
      if (!pluginHandle) {
        Sipgateway.debug("This handle is not attached to this session");
        return;
      }
      pluginHandle.mediaState(json["type"], json["receiving"]);
    } else if (json["janus"] === "slowlink") {
      Sipgateway.debug("Got a slowlink event on session " + sessionId);
      Sipgateway.debug(json);

      const sender = json["sender"];
      if (!sender) {
        Sipgateway.warn("Missing sender...");
        return;
      }
      const pluginHandle = pluginHandles[sender];
      if (!pluginHandle) {
        Sipgateway.debug("This handle is not attached to this session");
        return;
      }
      pluginHandle.slowLink(json["uplink"], json["lost"]);
    } else if (json["janus"] === "error") {
      Sipgateway.error(
        "Ooops: " + json["error"].code + " " + json["error"].reason
      );
      Sipgateway.debug(json);
      var transaction = json["transaction"];
      if (transaction) {
        var reportSuccess = transactions[transaction];
        if (reportSuccess) {
          reportSuccess(json);
        }
        delete transactions[transaction];
      }
      return;
    } else if (json["janus"] === "event") {
      Sipgateway.debug("Got a plugin event on session " + sessionId);
      Sipgateway.debug(json);
      const sender = json["sender"];
      if (!sender) {
        Sipgateway.warn("Missing sender...");
        return;
      }
      var plugindata = json["plugindata"];
      if (!plugindata) {
        Sipgateway.warn("Missing plugindata...");
        return;
      }
      Sipgateway.debug(
        "  -- Event is coming from " +
          sender +
          " (" +
          plugindata["plugin"] +
          ")"
      );
      var data = plugindata["data"];
      Sipgateway.debug(data);
      const pluginHandle = pluginHandles[sender];
      if (!pluginHandle) {
        Sipgateway.warn("This handle is not attached to this session");
        return;
      }
      var jsep = json["jsep"];
      if (jsep) {
        Sipgateway.debug("Handling SDP as well...");
        Sipgateway.debug(jsep);
      }
      var callback = pluginHandle.onmessage;
      if (callback) {
        Sipgateway.debug("Notifying application...");

        callback(data, jsep);
      } else {
        Sipgateway.debug("No provided notification callback");
      }
    } else if (json["janus"] === "timeout") {
      Sipgateway.error("Timeout on session " + sessionId);
      Sipgateway.debug(json);
      if (websockets) {
        ws.close(3504, "Gateway timeout");
      }
      return;
    } else {
      Sipgateway.warn(
        "Unknown message/event  '" + json["janus"] + "' on session " + sessionId
      );
      Sipgateway.debug(json);
    }
  }

  function keepAlive() {
    if (!server || !websockets || !connected) return;
    wsKeepaliveTimeoutId = setTimeout(keepAlive, keepAlivePeriod);
    var request = {
      janus: "keepalive",
      session_id: sessionId,
      transaction: Sipgateway.randomString(12),
    };
    if (token) request["token"] = token;
    if (apisecret) request["apisecret"] = apisecret;
    ws.send(JSON.stringify(request));
  }

  function createSession(callbacks) {
    var transaction = Sipgateway.randomString(12);
    var request = { janus: "create", transaction: transaction };
    if (callbacks["reconnect"]) {
      connected = false;
      request["janus"] = "claim";
      request["session_id"] = sessionId;

      if (ws) {
        ws.onopen = null;
        ws.onerror = null;
        ws.onclose = null;
        if (wsKeepaliveTimeoutId) {
          clearTimeout(wsKeepaliveTimeoutId);
          wsKeepaliveTimeoutId = null;
        }
      }
    }
    if (token) request["token"] = token;
    if (apisecret) request["apisecret"] = apisecret;
    if (!server && Sipgateway.isArray(servers)) {
      server = servers[serversIndex];
      if (server.indexOf("ws") === 0) {
        websockets = true;
        Sipgateway.log(
          "Server #" +
            (serversIndex + 1) +
            ": trying WebSockets to contact Sipgateway (" +
            server +
            ")"
        );
      } else {
        websockets = false;
        Sipgateway.log(
          "Server #" +
            (serversIndex + 1) +
            ": trying REST API to contact Sipgateway (" +
            server +
            ")"
        );
      }
    }
    if (websockets) {
      ws = Sipgateway.newWebSocket(server, "janus-protocol");
      wsHandlers = {
        error: function () {
          Sipgateway.error(
            "Error connecting to the Sipgateway WebSockets server... " + server
          );
          if (Sipgateway.isArray(servers) && !callbacks["reconnect"]) {
            serversIndex++;
            if (serversIndex === servers.length) {
              callbacks.error(
                "Error connecting to any of the provided Sipgateway servers: Is the server down?"
              );
              return;
            }

            server = null;
            setTimeout(function () {
              createSession(callbacks);
            }, 200);
            return;
          }
          callbacks.error(
            "Error connecting to the Sipgateway WebSockets server: Is the server down?"
          );
        },
        open: function () {
          transactions[transaction] = function (json) {
            Sipgateway.debug(json);
            if (json["janus"] !== "success") {
              Sipgateway.error(
                "Ooops: " + json["error"].code + " " + json["error"].reason
              );
              callbacks.error(json["error"].reason);
              return;
            }
            wsKeepaliveTimeoutId = setTimeout(keepAlive, keepAlivePeriod);
            connected = true;
            sessionId = json["session_id"]
              ? json["session_id"]
              : json.data["id"];
            if (callbacks["reconnect"]) {
              Sipgateway.log("Claimed session: " + sessionId);
            } else {
              Sipgateway.log("Created session: " + sessionId);
            }
            Sipgateway.sessions[sessionId] = that;
            callbacks.success();
          };
          ws.send(JSON.stringify(request));
        },
        message: function (event) {
          handleEvent(JSON.parse(event.data));
        },
        close: function () {
          if (!server || !connected) {
            return;
          }
          connected = false;

          gatewayCallbacks.error("Lost connection to the server (is it down?)");
        },
      };
      for (var eventName in wsHandlers) {
        ws.addEventListener(eventName, wsHandlers[eventName]);
      }
      return;
    }
    Sipgateway.httpAPICall(server, {
      verb: "POST",
      withCredentials: withCredentials,
      body: request,
      success: function (json) {
        Sipgateway.debug(json);
        if (json["janus"] !== "success") {
          Sipgateway.error(
            "Ooops: " + json["error"].code + " " + json["error"].reason
          );
          callbacks.error(json["error"].reason);
          return;
        }
        connected = true;
        sessionId = json["session_id"] ? json["session_id"] : json.data["id"];
        if (callbacks["reconnect"]) {
          Sipgateway.log("Claimed session: " + sessionId);
        } else {
          Sipgateway.log("Created session: " + sessionId);
        }
        Sipgateway.sessions[sessionId] = that;
        eventHandler();
        callbacks.success();
      },
      error: function (textStatus, errorThrown) {
        Sipgateway.error(textStatus + ":", errorThrown);
        if (Sipgateway.isArray(servers) && !callbacks["reconnect"]) {
          serversIndex++;
          if (serversIndex === servers.length) {
            callbacks.error(
              "Error connecting to any of the provided Sipgateway servers: Is the server down?"
            );
            return;
          }

          server = null;
          setTimeout(function () {
            createSession(callbacks);
          }, 200);
          return;
        }
        if (errorThrown === "")
          callbacks.error(textStatus + ": Is the server down?");
        else if (errorThrown && errorThrown.error)
          callbacks.error(textStatus + ": " + errorThrown.error.message);
        else callbacks.error(textStatus + ": " + errorThrown);
      },
    });
  }

  function getInfo(callbacks) {
    callbacks = callbacks || {};

    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    Sipgateway.log("Getting info on Sipgateway instance");
    if (!connected) {
      Sipgateway.warn("Is the server down? (connected=false)");
      callbacks.error("Is the server down? (connected=false)");
      return;
    }

    var transaction = Sipgateway.randomString(12);
    var request = { janus: "info", transaction: transaction };
    if (token) request["token"] = token;
    if (apisecret) request["apisecret"] = apisecret;
    if (websockets) {
      transactions[transaction] = function (json) {
        Sipgateway.log("Server info:");
        Sipgateway.debug(json);
        if (json["janus"] !== "server_info") {
          Sipgateway.error(
            "Ooops: " + json["error"].code + " " + json["error"].reason
          );
        }
        callbacks.success(json);
      };
      ws.send(JSON.stringify(request));
      return;
    }
    Sipgateway.httpAPICall(server, {
      verb: "POST",
      withCredentials: withCredentials,
      body: request,
      success: function (json) {
        Sipgateway.log("Server info:");
        Sipgateway.debug(json);
        if (json["janus"] !== "server_info") {
          Sipgateway.error(
            "Ooops: " + json["error"].code + " " + json["error"].reason
          );
        }
        callbacks.success(json);
      },
      error: function (textStatus, errorThrown) {
        Sipgateway.error(textStatus + ":", errorThrown);
        if (errorThrown === "")
          callbacks.error(textStatus + ": Is the server down?");
        else callbacks.error(textStatus + ": " + errorThrown);
      },
    });
  }

  function destroySession(callbacks) {
    callbacks = callbacks || {};

    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    var unload = callbacks.unload === true;
    var notifyDestroyed = true;
    if (
      callbacks.notifyDestroyed !== undefined &&
      callbacks.notifyDestroyed !== null
    )
      notifyDestroyed = callbacks.notifyDestroyed === true;
    var cleanupHandles = callbacks.cleanupHandles === true;
    Sipgateway.log(
      "Destroying session " + sessionId + " (unload=" + unload + ")"
    );
    if (!sessionId) {
      Sipgateway.warn("No session to destroy");
      callbacks.success();
      if (notifyDestroyed) gatewayCallbacks.destroyed();
      return;
    }
    if (cleanupHandles) {
      for (var handleId in pluginHandles)
        destroyHandle(handleId, { noRequest: true });
    }
    if (!connected) {
      Sipgateway.warn("Is the server down? (connected=false)");
      sessionId = null;
      callbacks.success();
      return;
    }

    var request = {
      janus: "destroy",
      transaction: Sipgateway.randomString(12),
    };
    if (token) request["token"] = token;
    if (apisecret) request["apisecret"] = apisecret;
    if (unload) {
      if (websockets) {
        ws.onclose = null;
        ws.close();
        ws = null;
      } else {
        navigator.sendBeacon(server + "/" + sessionId, JSON.stringify(request));
      }
      Sipgateway.log("Destroyed session:");
      sessionId = null;
      connected = false;
      callbacks.success();
      if (notifyDestroyed) gatewayCallbacks.destroyed();
      return;
    }
    if (websockets) {
      request["session_id"] = sessionId;
      var unbindWebSocket = function () {
        for (var eventName in wsHandlers) {
          ws.removeEventListener(eventName, wsHandlers[eventName]);
        }
        ws.removeEventListener("message", onUnbindMessage);
        ws.removeEventListener("error", onUnbindError);
        if (wsKeepaliveTimeoutId) {
          clearTimeout(wsKeepaliveTimeoutId);
        }
        ws.close();
      };
      var onUnbindMessage = function (event) {
        var data = JSON.parse(event.data);
        if (
          data.session_id == request.session_id &&
          data.transaction == request.transaction
        ) {
          unbindWebSocket();
          callbacks.success();
          if (notifyDestroyed) gatewayCallbacks.destroyed();
        }
      };
      var onUnbindError = function () {
        unbindWebSocket();
        callbacks.error("Failed to destroy the server: Is the server down?");
        if (notifyDestroyed) gatewayCallbacks.destroyed();
      };
      ws.addEventListener("message", onUnbindMessage);
      ws.addEventListener("error", onUnbindError);
      if (ws.readyState === 1) {
        ws.send(JSON.stringify(request));
      } else {
        onUnbindError();
      }
      return;
    }
    Sipgateway.httpAPICall(server + "/" + sessionId, {
      verb: "POST",
      withCredentials: withCredentials,
      body: request,
      success: function (json) {
        Sipgateway.log("Destroyed session:");
        Sipgateway.debug(json);
        sessionId = null;
        connected = false;
        if (json["janus"] !== "success") {
          Sipgateway.error(
            "Ooops: " + json["error"].code + " " + json["error"].reason
          );
        }
        callbacks.success();
        if (notifyDestroyed) gatewayCallbacks.destroyed();
      },
      error: function (textStatus, errorThrown) {
        Sipgateway.error(textStatus + ":", errorThrown);

        sessionId = null;
        connected = false;
        callbacks.success();
        if (notifyDestroyed) gatewayCallbacks.destroyed();
      },
    });
  }

  function createHandle(callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    callbacks.dataChannelOptions = callbacks.dataChannelOptions || {
      ordered: true,
    };
    callbacks.consentDialog =
      typeof callbacks.consentDialog == "function"
        ? callbacks.consentDialog
        : Sipgateway.noop;
    callbacks.iceState =
      typeof callbacks.iceState == "function"
        ? callbacks.iceState
        : Sipgateway.noop;
    callbacks.mediaState =
      typeof callbacks.mediaState == "function"
        ? callbacks.mediaState
        : Sipgateway.noop;
    callbacks.webrtcState =
      typeof callbacks.webrtcState == "function"
        ? callbacks.webrtcState
        : Sipgateway.noop;
    callbacks.slowLink =
      typeof callbacks.slowLink == "function"
        ? callbacks.slowLink
        : Sipgateway.noop;
    callbacks.onmessage =
      typeof callbacks.onmessage == "function"
        ? callbacks.onmessage
        : Sipgateway.noop;
    callbacks.onlocalstream =
      typeof callbacks.onlocalstream == "function"
        ? callbacks.onlocalstream
        : Sipgateway.noop;
    callbacks.onremotestream =
      typeof callbacks.onremotestream == "function"
        ? callbacks.onremotestream
        : Sipgateway.noop;
    callbacks.ondata =
      typeof callbacks.ondata == "function"
        ? callbacks.ondata
        : Sipgateway.noop;
    callbacks.ondataopen =
      typeof callbacks.ondataopen == "function"
        ? callbacks.ondataopen
        : Sipgateway.noop;
    callbacks.oncleanup =
      typeof callbacks.oncleanup == "function"
        ? callbacks.oncleanup
        : Sipgateway.noop;
    callbacks.ondetached =
      typeof callbacks.ondetached == "function"
        ? callbacks.ondetached
        : Sipgateway.noop;
    if (!connected) {
      Sipgateway.warn("Is the server down? (connected=false)");
      callbacks.error("Is the server down? (connected=false)");
      return;
    }
    var plugin = callbacks.plugin;
    if (!plugin) {
      Sipgateway.error("Invalid plugin");
      callbacks.error("Invalid plugin");
      return;
    }
    var opaqueId = callbacks.opaqueId;
    var loopIndex = callbacks.loopIndex;
    var handleToken = callbacks.token ? callbacks.token : token;
    var transaction = Sipgateway.randomString(12);
    var request = {
      janus: "attach",
      plugin: plugin,
      opaque_id: opaqueId,
      loop_index: loopIndex,
      transaction: transaction,
    };
    if (handleToken) request["token"] = handleToken;
    if (apisecret) request["apisecret"] = apisecret;
    if (websockets) {
      transactions[transaction] = function (json) {
        Sipgateway.debug(json);
        if (json["janus"] !== "success") {
          Sipgateway.error(
            "Ooops: " + json["error"].code + " " + json["error"].reason
          );
          callbacks.error(
            "Ooops: " + json["error"].code + " " + json["error"].reason
          );
          return;
        }
        var handleId = json.data["id"];
        Sipgateway.log("Created handle: " + handleId);
        var pluginHandle = {
          session: that,
          plugin: plugin,
          id: handleId,
          token: handleToken,
          detached: false,
          webrtcStuff: {
            started: false,
            myStream: null,
            streamExternal: false,
            remoteStream: null,
            mySdp: null,
            mediaConstraints: null,
            pc: null,
            dataChannelOptions: callbacks.dataChannelOptions,
            dataChannel: {},
            dtmfSender: null,
            trickle: true,
            iceDone: false,
            volume: {
              value: null,
              timer: null,
            },
            bitrate: {
              value: null,
              bsnow: null,
              bsbefore: null,
              tsnow: null,
              tsbefore: null,
              timer: null,
            },
          },
          getId: function () {
            return handleId;
          },
          getPlugin: function () {
            return plugin;
          },
          getVolume: function () {
            return getVolume(handleId, true);
          },
          getRemoteVolume: function () {
            return getVolume(handleId, true);
          },
          getLocalVolume: function () {
            return getVolume(handleId, false);
          },
          isAudioMuted: function () {
            return isMuted(handleId, false);
          },
          muteAudio: function () {
            return mute(handleId, false, true);
          },
          unmuteAudio: function () {
            return mute(handleId, false, false);
          },
          isVideoMuted: function () {
            return isMuted(handleId, true);
          },
          muteVideo: function () {
            return mute(handleId, true, true);
          },
          unmuteVideo: function () {
            return mute(handleId, true, false);
          },
          getBitrate: function () {
            return getBitrate(handleId);
          },
          send: function (callbacks) {
            sendMessage(handleId, callbacks);
          },
          data: function (callbacks) {
            sendData(handleId, callbacks);
          },
          dtmf: function (callbacks) {
            sendDtmf(handleId, callbacks);
          },
          consentDialog: callbacks.consentDialog,
          iceState: callbacks.iceState,
          mediaState: callbacks.mediaState,
          webrtcState: callbacks.webrtcState,
          slowLink: callbacks.slowLink,
          onmessage: callbacks.onmessage,
          createOffer: function (callbacks) {
            prepareWebrtc(handleId, true, callbacks);
          },
          createAnswer: function (callbacks) {
            prepareWebrtc(handleId, false, callbacks);
          },
          handleRemoteJsep: function (callbacks) {
            prepareWebrtcPeer(handleId, callbacks);
          },
          onlocalstream: callbacks.onlocalstream,
          onremotestream: callbacks.onremotestream,
          ondata: callbacks.ondata,
          ondataopen: callbacks.ondataopen,
          oncleanup: callbacks.oncleanup,
          ondetached: callbacks.ondetached,
          hangup: function (sendRequest) {
            cleanupWebrtc(handleId, sendRequest === true);
          },
          detach: function (callbacks) {
            destroyHandle(handleId, callbacks);
          },
        };
        pluginHandles[handleId] = pluginHandle;
        callbacks.success(pluginHandle);
      };
      request["session_id"] = sessionId;
      ws.send(JSON.stringify(request));
      return;
    }
    Sipgateway.httpAPICall(server + "/" + sessionId, {
      verb: "POST",
      withCredentials: withCredentials,
      body: request,
      success: function (json) {
        Sipgateway.debug(json);
        if (json["janus"] !== "success") {
          Sipgateway.error(
            "Ooops: " + json["error"].code + " " + json["error"].reason
          );
          callbacks.error(
            "Ooops: " + json["error"].code + " " + json["error"].reason
          );
          return;
        }
        var handleId = json.data["id"];
        Sipgateway.log("Created handle: " + handleId);
        var pluginHandle = {
          session: that,
          plugin: plugin,
          id: handleId,
          token: handleToken,
          detached: false,
          webrtcStuff: {
            started: false,
            myStream: null,
            streamExternal: false,
            remoteStream: null,
            mySdp: null,
            mediaConstraints: null,
            pc: null,
            dataChannelOptions: callbacks.dataChannelOptions,
            dataChannel: {},
            dtmfSender: null,
            trickle: true,
            iceDone: false,
            volume: {
              value: null,
              timer: null,
            },
            bitrate: {
              value: null,
              bsnow: null,
              bsbefore: null,
              tsnow: null,
              tsbefore: null,
              timer: null,
            },
          },
          getId: function () {
            return handleId;
          },
          getPlugin: function () {
            return plugin;
          },
          getVolume: function () {
            return getVolume(handleId, true);
          },
          getRemoteVolume: function () {
            return getVolume(handleId, true);
          },
          getLocalVolume: function () {
            return getVolume(handleId, false);
          },
          isAudioMuted: function () {
            return isMuted(handleId, false);
          },
          muteAudio: function () {
            return mute(handleId, false, true);
          },
          unmuteAudio: function () {
            return mute(handleId, false, false);
          },
          isVideoMuted: function () {
            return isMuted(handleId, true);
          },
          muteVideo: function () {
            return mute(handleId, true, true);
          },
          unmuteVideo: function () {
            return mute(handleId, true, false);
          },
          getBitrate: function () {
            return getBitrate(handleId);
          },
          send: function (callbacks) {
            sendMessage(handleId, callbacks);
          },
          data: function (callbacks) {
            sendData(handleId, callbacks);
          },
          dtmf: function (callbacks) {
            sendDtmf(handleId, callbacks);
          },
          consentDialog: callbacks.consentDialog,
          iceState: callbacks.iceState,
          mediaState: callbacks.mediaState,
          webrtcState: callbacks.webrtcState,
          slowLink: callbacks.slowLink,
          onmessage: callbacks.onmessage,
          createOffer: function (callbacks) {
            prepareWebrtc(handleId, true, callbacks);
          },
          createAnswer: function (callbacks) {
            prepareWebrtc(handleId, false, callbacks);
          },
          handleRemoteJsep: function (callbacks) {
            prepareWebrtcPeer(handleId, callbacks);
          },
          onlocalstream: callbacks.onlocalstream,
          onremotestream: callbacks.onremotestream,
          ondata: callbacks.ondata,
          ondataopen: callbacks.ondataopen,
          oncleanup: callbacks.oncleanup,
          ondetached: callbacks.ondetached,
          hangup: function (sendRequest) {
            cleanupWebrtc(handleId, sendRequest === true);
          },
          detach: function (callbacks) {
            destroyHandle(handleId, callbacks);
          },
        };
        pluginHandles[handleId] = pluginHandle;
        callbacks.success(pluginHandle);
      },
      error: function (textStatus, errorThrown) {
        Sipgateway.error(textStatus + ":", errorThrown);
        if (errorThrown === "")
          callbacks.error(textStatus + ": Is the server down?");
        else callbacks.error(textStatus + ": " + errorThrown);
      },
    });
  }

  function sendMessage(handleId, callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    if (!connected) {
      Sipgateway.warn("Is the server down? (connected=false)");
      callbacks.error("Is the server down? (connected=false)");
      return;
    }
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      callbacks.error("Invalid handle");
      return;
    }
    var message = callbacks.message;
    var jsep = callbacks.jsep;
    var transaction = Sipgateway.randomString(12);
    var request = { janus: "message", body: message, transaction: transaction };
    if (pluginHandle.token) request["token"] = pluginHandle.token;
    if (apisecret) request["apisecret"] = apisecret;
    if (jsep) {
      request.jsep = {
        type: jsep.type,
        sdp: jsep.sdp,
      };
      if (jsep.e2ee) request.jsep.e2ee = true;
      if (jsep.rid_order === "hml" || jsep.rid_order === "lmh")
        request.jsep.rid_order = jsep.rid_order;
      if (jsep.force_relay) request.jsep.force_relay = true;
    }
    Sipgateway.debug("Sending message to plugin (handle=" + handleId + "):");
    Sipgateway.debug(request);
    if (websockets) {
      request["session_id"] = sessionId;
      request["handle_id"] = handleId;
      transactions[transaction] = function (json) {
        Sipgateway.debug("Message sent!");
        Sipgateway.debug(json);
        if (json["janus"] === "success") {
          var plugindata = json["plugindata"];
          if (!plugindata) {
            Sipgateway.warn("Request succeeded, but missing plugindata...");
            callbacks.success();
            return;
          }
          Sipgateway.log(
            "Synchronous transaction successful (" + plugindata["plugin"] + ")"
          );
          var data = plugindata["data"];
          Sipgateway.debug(data);
          callbacks.success(data);
          return;
        } else if (json["janus"] !== "ack") {
          if (json["error"]) {
            Sipgateway.error(
              "Ooops: " + json["error"].code + " " + json["error"].reason
            );
            callbacks.error(json["error"].code + " " + json["error"].reason);
          } else {
            Sipgateway.error("Unknown error");
            callbacks.error("Unknown error");
          }
          return;
        }

        callbacks.success();
      };
      ws.send(JSON.stringify(request));
      return;
    }
    Sipgateway.httpAPICall(server + "/" + sessionId + "/" + handleId, {
      verb: "POST",
      withCredentials: withCredentials,
      body: request,
      success: function (json) {
        Sipgateway.debug("Message sent!");
        Sipgateway.debug(json);
        if (json["janus"] === "success") {
          var plugindata = json["plugindata"];
          if (!plugindata) {
            Sipgateway.warn("Request succeeded, but missing plugindata...");
            callbacks.success();
            return;
          }
          Sipgateway.log(
            "Synchronous transaction successful (" + plugindata["plugin"] + ")"
          );
          var data = plugindata["data"];
          Sipgateway.debug(data);
          callbacks.success(data);
          return;
        } else if (json["janus"] !== "ack") {
          if (json["error"]) {
            Sipgateway.error(
              "Ooops: " + json["error"].code + " " + json["error"].reason
            );
            callbacks.error(json["error"].code + " " + json["error"].reason);
          } else {
            Sipgateway.error("Unknown error");
            callbacks.error("Unknown error");
          }
          return;
        }

        callbacks.success();
      },
      error: function (textStatus, errorThrown) {
        Sipgateway.error(textStatus + ":", errorThrown);
        callbacks.error(textStatus + ": " + errorThrown);
      },
    });
  }

  function sendTrickleCandidate(handleId, candidate) {
    if (!connected) {
      Sipgateway.warn("Is the server down? (connected=false)");
      return;
    }
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      return;
    }
    var request = {
      janus: "trickle",
      candidate: candidate,
      transaction: Sipgateway.randomString(12),
    };
    if (pluginHandle.token) request["token"] = pluginHandle.token;
    if (apisecret) request["apisecret"] = apisecret;
    Sipgateway.vdebug("Sending trickle candidate (handle=" + handleId + "):");
    Sipgateway.vdebug(request);
    if (websockets) {
      request["session_id"] = sessionId;
      request["handle_id"] = handleId;
      ws.send(JSON.stringify(request));
      return;
    }
    Sipgateway.httpAPICall(server + "/" + sessionId + "/" + handleId, {
      verb: "POST",
      withCredentials: withCredentials,
      body: request,
      success: function (json) {
        Sipgateway.vdebug("Candidate sent!");
        Sipgateway.vdebug(json);
        if (json["janus"] !== "ack") {
          Sipgateway.error(
            "Ooops: " + json["error"].code + " " + json["error"].reason
          );
          return;
        }
      },
      error: function (textStatus, errorThrown) {
        Sipgateway.error(textStatus + ":", errorThrown);
      },
    });
  }

  function createDataChannel(
    handleId,
    dclabel,
    dcprotocol,
    incoming,
    pendingData
  ) {
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      return;
    }
    var config = pluginHandle.webrtcStuff;
    if (!config.pc) {
      Sipgateway.warn("Invalid PeerConnection");
      return;
    }
    var onDataChannelMessage = function (event) {
      Sipgateway.log("Received message on data channel:", event);
      var label = event.target.label;
      pluginHandle.ondata(event.data, label);
    };
    var onDataChannelStateChange = function (event) {
      Sipgateway.log("Received state change on data channel:", event);
      var label = event.target.label;
      var protocol = event.target.protocol;
      var dcState = config.dataChannel[label]
        ? config.dataChannel[label].readyState
        : "null";
      Sipgateway.log(
        "State change on <" + label + "> data channel: " + dcState
      );
      if (dcState === "open") {
        if (
          config.dataChannel[label].pending &&
          config.dataChannel[label].pending.length > 0
        ) {
          Sipgateway.log(
            "Sending pending messages on <" + label + ">:",
            config.dataChannel[label].pending.length
          );
          for (var data of config.dataChannel[label].pending) {
            Sipgateway.log("Sending data on data channel <" + label + ">");
            Sipgateway.debug(data);
            config.dataChannel[label].send(data);
          }
          config.dataChannel[label].pending = [];
        }

        pluginHandle.ondataopen(label, protocol);
      }
    };
    var onDataChannelError = function (error) {
      Sipgateway.error("Got error on data channel:", error);
    };
    if (!incoming) {
      var dcoptions = config.dataChannelOptions;
      if (dcprotocol) dcoptions.protocol = dcprotocol;
      config.dataChannel[dclabel] = config.pc.createDataChannel(
        dclabel,
        dcoptions
      );
    } else {
      config.dataChannel[dclabel] = incoming;
    }
    config.dataChannel[dclabel].onmessage = onDataChannelMessage;
    config.dataChannel[dclabel].onopen = onDataChannelStateChange;
    config.dataChannel[dclabel].onclose = onDataChannelStateChange;
    config.dataChannel[dclabel].onerror = onDataChannelError;
    config.dataChannel[dclabel].pending = [];
    if (pendingData) config.dataChannel[dclabel].pending.push(pendingData);
  }

  function sendData(handleId, callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      callbacks.error("Invalid handle");
      return;
    }
    var config = pluginHandle.webrtcStuff;
    var data = callbacks.text || callbacks.data;
    if (!data) {
      Sipgateway.warn("Invalid data");
      callbacks.error("Invalid data");
      return;
    }
    var label = callbacks.label
      ? callbacks.label
      : Sipgateway.dataChanDefaultLabel;
    if (!config.dataChannel[label]) {
      createDataChannel(
        handleId,
        label,
        callbacks.protocol,
        false,
        data,
        callbacks.protocol
      );
      callbacks.success();
      return;
    }
    if (config.dataChannel[label].readyState !== "open") {
      config.dataChannel[label].pending.push(data);
      callbacks.success();
      return;
    }
    Sipgateway.log("Sending data on data channel <" + label + ">");
    Sipgateway.debug(data);
    config.dataChannel[label].send(data);
    callbacks.success();
  }

  function sendDtmf(handleId, callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      callbacks.error("Invalid handle");
      return;
    }
    var config = pluginHandle.webrtcStuff;
    if (!config.dtmfSender) {
      if (config.pc) {
        var senders = config.pc.getSenders();
        var audioSender = senders.find(function (sender) {
          return sender.track && sender.track.kind === "audio";
        });
        if (!audioSender) {
          Sipgateway.warn("Invalid DTMF configuration (no audio track)");
          callbacks.error("Invalid DTMF configuration (no audio track)");
          return;
        }
        config.dtmfSender = audioSender.dtmf;
        if (config.dtmfSender) {
          Sipgateway.log("Created DTMF Sender");
          config.dtmfSender.ontonechange = function (tone) {
            Sipgateway.debug("Sent DTMF tone: " + tone.tone);
          };
        }
      }
      if (!config.dtmfSender) {
        Sipgateway.warn("Invalid DTMF configuration");
        callbacks.error("Invalid DTMF configuration");
        return;
      }
    }
    var dtmf = callbacks.dtmf;
    if (!dtmf) {
      Sipgateway.warn("Invalid DTMF parameters");
      callbacks.error("Invalid DTMF parameters");
      return;
    }
    var tones = dtmf.tones;
    if (!tones) {
      Sipgateway.warn("Invalid DTMF string");
      callbacks.error("Invalid DTMF string");
      return;
    }
    var duration = typeof dtmf.duration === "number" ? dtmf.duration : 500;
    var gap = typeof dtmf.gap === "number" ? dtmf.gap : 50;
    Sipgateway.debug(
      "Sending DTMF string " +
        tones +
        " (duration " +
        duration +
        "ms, gap " +
        gap +
        "ms)"
    );
    config.dtmfSender.insertDTMF(tones, duration, gap);
    callbacks.success();
  }

  function destroyHandle(handleId, callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    var noRequest = callbacks.noRequest === true;
    Sipgateway.log(
      "Destroying handle " + handleId + " (only-locally=" + noRequest + ")"
    );
    cleanupWebrtc(handleId);
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || pluginHandle.detached) {
      delete pluginHandles[handleId];
      callbacks.success();
      return;
    }
    pluginHandle.detached = true;
    if (noRequest) {
      delete pluginHandles[handleId];
      callbacks.success();
      return;
    }
    if (!connected) {
      Sipgateway.warn("Is the server down? (connected=false)");
      callbacks.error("Is the server down? (connected=false)");
      return;
    }
    var request = { janus: "detach", transaction: Sipgateway.randomString(12) };
    if (pluginHandle.token) request["token"] = pluginHandle.token;
    if (apisecret) request["apisecret"] = apisecret;
    if (websockets) {
      request["session_id"] = sessionId;
      request["handle_id"] = handleId;
      ws.send(JSON.stringify(request));
      delete pluginHandles[handleId];
      callbacks.success();
      return;
    }
    Sipgateway.httpAPICall(server + "/" + sessionId + "/" + handleId, {
      verb: "POST",
      withCredentials: withCredentials,
      body: request,
      success: function (json) {
        Sipgateway.log("Destroyed handle:");
        Sipgateway.debug(json);
        if (json["janus"] !== "success") {
          Sipgateway.error(
            "Ooops: " + json["error"].code + " " + json["error"].reason
          );
        }
        delete pluginHandles[handleId];
        callbacks.success();
      },
      error: function (textStatus, errorThrown) {
        Sipgateway.error(textStatus + ":", errorThrown);

        delete pluginHandles[handleId];
        callbacks.success();
      },
    });
  }

  function streamsDone(handleId, jsep, media, callbacks, stream) {
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");

      if (!callbacks.stream) {
        Sipgateway.stopAllTracks(stream);
      }
      callbacks.error("Invalid handle");
      return;
    }
    var config = pluginHandle.webrtcStuff;
    Sipgateway.debug("streamsDone:", stream);
    if (stream) {
      Sipgateway.debug("  -- Audio tracks:", stream.getAudioTracks());
      Sipgateway.debug("  -- Video tracks:", stream.getVideoTracks());
    }

    var addTracks = false;
    if (
      !config.myStream ||
      !media.update ||
      (config.streamExternal && !media.replaceAudio && !media.replaceVideo)
    ) {
      config.myStream = stream;
      addTracks = true;
    } else {
      if (
        ((!media.update && isAudioSendEnabled(media)) ||
          (media.update && (media.addAudio || media.replaceAudio))) &&
        stream.getAudioTracks() &&
        stream.getAudioTracks().length
      ) {
        config.myStream.addTrack(stream.getAudioTracks()[0]);
        if (Sipgateway.unifiedPlan) {
          Sipgateway.log(
            (media.replaceAudio ? "Replacing" : "Adding") + " audio track:",
            stream.getAudioTracks()[0]
          );
          var audioTransceiver = null;
          const transceivers = config.pc.getTransceivers();
          if (transceivers && transceivers.length > 0) {
            for (const t of transceivers) {
              if (
                (t.sender &&
                  t.sender.track &&
                  t.sender.track.kind === "audio") ||
                (t.receiver &&
                  t.receiver.track &&
                  t.receiver.track.kind === "audio")
              ) {
                audioTransceiver = t;
                break;
              }
            }
          }
          if (audioTransceiver && audioTransceiver.sender) {
            audioTransceiver.sender.replaceTrack(stream.getAudioTracks()[0]);
          } else {
            config.pc.addTrack(stream.getAudioTracks()[0], stream);
          }
        } else {
          Sipgateway.log(
            (media.replaceAudio ? "Replacing" : "Adding") + " audio track:",
            stream.getAudioTracks()[0]
          );
          config.pc.addTrack(stream.getAudioTracks()[0], stream);
        }
      }
      if (
        ((!media.update && isVideoSendEnabled(media)) ||
          (media.update && (media.addVideo || media.replaceVideo))) &&
        stream.getVideoTracks() &&
        stream.getVideoTracks().length
      ) {
        config.myStream.addTrack(stream.getVideoTracks()[0]);
        if (Sipgateway.unifiedPlan) {
          Sipgateway.log(
            (media.replaceVideo ? "Replacing" : "Adding") + " video track:",
            stream.getVideoTracks()[0]
          );
          var videoTransceiver = null;
          const transceivers = config.pc.getTransceivers();
          if (transceivers && transceivers.length > 0) {
            for (const t of transceivers) {
              if (
                (t.sender &&
                  t.sender.track &&
                  t.sender.track.kind === "video") ||
                (t.receiver &&
                  t.receiver.track &&
                  t.receiver.track.kind === "video")
              ) {
                videoTransceiver = t;
                break;
              }
            }
          }
          if (videoTransceiver && videoTransceiver.sender) {
            videoTransceiver.sender.replaceTrack(stream.getVideoTracks()[0]);
          } else {
            config.pc.addTrack(stream.getVideoTracks()[0], stream);
          }
        } else {
          Sipgateway.log(
            (media.replaceVideo ? "Replacing" : "Adding") + " video track:",
            stream.getVideoTracks()[0]
          );
          config.pc.addTrack(stream.getVideoTracks()[0], stream);
        }
      }
    }

    if (!config.pc) {
      var pc_config = {
        iceServers: iceServers,
        iceTransportPolicy: iceTransportPolicy,
        bundlePolicy: bundlePolicy,
      };
      if (Sipgateway.webRTCAdapter.browserDetails.browser === "chrome") {
        pc_config["sdpSemantics"] =
          Sipgateway.webRTCAdapter.browserDetails.version < 72
            ? "plan-b"
            : "unified-plan";
      }
      var pc_constraints = {
        optional: [{ DtlsSrtpKeyAgreement: true }],
      };
      if (ipv6Support) {
        pc_constraints.optional.push({ googIPv6: true });
      }

      if (
        callbacks.rtcConstraints &&
        typeof callbacks.rtcConstraints === "object"
      ) {
        Sipgateway.debug(
          "Adding custom PeerConnection constraints:",
          callbacks.rtcConstraints
        );
        for (var i in callbacks.rtcConstraints) {
          pc_constraints.optional.push(callbacks.rtcConstraints[i]);
        }
      }
      if (Sipgateway.webRTCAdapter.browserDetails.browser === "edge") {
        pc_config.bundlePolicy = "max-bundle";
      }

      if (
        RTCRtpSender &&
        (RTCRtpSender.prototype.createEncodedStreams ||
          (RTCRtpSender.prototype.createEncodedAudioStreams &&
            RTCRtpSender.prototype.createEncodedVideoStreams)) &&
        (callbacks.senderTransforms || callbacks.receiverTransforms)
      ) {
        config.senderTransforms = callbacks.senderTransforms;
        config.receiverTransforms = callbacks.receiverTransforms;
        pc_config["forceEncodedAudioInsertableStreams"] = true;
        pc_config["forceEncodedVideoInsertableStreams"] = true;
        pc_config["encodedInsertableStreams"] = true;
      }
      Sipgateway.log("Creating PeerConnection");
      Sipgateway.debug(pc_constraints);
      config.pc = new RTCPeerConnection(pc_config, pc_constraints);
      Sipgateway.debug(config.pc);
      if (config.pc.getStats) {
        config.volume = {};
        config.bitrate.value = "0 kbits/sec";
      }
      Sipgateway.log(
        "Preparing local SDP and gathering candidates (trickle=" +
          config.trickle +
          ")"
      );
      config.pc.oniceconnectionstatechange = function () {
        if (config.pc) pluginHandle.iceState(config.pc.iceConnectionState);
      };
      config.pc.onicecandidate = function (event) {
        if (
          !event.candidate ||
          (Sipgateway.webRTCAdapter.browserDetails.browser === "edge" &&
            event.candidate.candidate.indexOf("endOfCandidates") > 0)
        ) {
          Sipgateway.log("End of candidates.");
          config.iceDone = true;
          if (config.trickle === true) {
            sendTrickleCandidate(handleId, { completed: true });
          } else {
            sendSDP(handleId, callbacks);
          }
        } else {
          var candidate = {
            candidate: event.candidate.candidate,
            sdpMid: event.candidate.sdpMid,
            sdpMLineIndex: event.candidate.sdpMLineIndex,
          };
          if (config.trickle === true) {
            sendTrickleCandidate(handleId, candidate);
          }
        }
      };
      config.pc.ontrack = function (event) {
        Sipgateway.log("Handling Remote Track");
        Sipgateway.debug(event);
        if (!event.streams) return;
        config.remoteStream = event.streams[0];
        pluginHandle.onremotestream(config.remoteStream);
        if (event.track.onended) return;
        if (config.receiverTransforms) {
          var receiverStreams = null;
          if (RTCRtpSender.prototype.createEncodedStreams) {
            receiverStreams = event.receiver.createEncodedStreams();
          } else if (
            RTCRtpSender.prototype.createAudioEncodedStreams ||
            RTCRtpSender.prototype.createEncodedVideoStreams
          ) {
            if (
              event.track.kind === "audio" &&
              config.receiverTransforms["audio"]
            ) {
              receiverStreams = event.receiver.createEncodedAudioStreams();
            } else if (
              event.track.kind === "video" &&
              config.receiverTransforms["video"]
            ) {
              receiverStreams = event.receiver.createEncodedVideoStreams();
            }
          }
          if (receiverStreams) {
            console.log(receiverStreams);
            if (
              receiverStreams.readableStream &&
              receiverStreams.writableStream
            ) {
              receiverStreams.readableStream
                .pipeThrough(config.receiverTransforms[event.track.kind])
                .pipeTo(receiverStreams.writableStream);
            } else if (receiverStreams.readable && receiverStreams.writable) {
              receiverStreams.readable
                .pipeThrough(config.receiverTransforms[event.track.kind])
                .pipeTo(receiverStreams.writable);
            }
          }
        }
        var trackMutedTimeoutId = null;
        Sipgateway.log("Adding onended callback to track:", event.track);
        event.track.onended = function (ev) {
          Sipgateway.log("Remote track removed:", ev);
          if (config.remoteStream) {
            clearTimeout(trackMutedTimeoutId);
            config.remoteStream.removeTrack(ev.target);
            pluginHandle.onremotestream(config.remoteStream);
          }
        };
        event.track.onmute = function (ev) {
          Sipgateway.log("Remote track muted:", ev);
          if (config.remoteStream && trackMutedTimeoutId == null) {
            trackMutedTimeoutId = setTimeout(function () {
              Sipgateway.log("Removing remote track");
              if (config.remoteStream) {
                config.remoteStream.removeTrack(ev.target);
                pluginHandle.onremotestream(config.remoteStream);
              }
              trackMutedTimeoutId = null;
            }, 3 * 840);
          }
        };
        event.track.onunmute = function (ev) {
          Sipgateway.log("Remote track flowing again:", ev);
          if (trackMutedTimeoutId != null) {
            clearTimeout(trackMutedTimeoutId);
            trackMutedTimeoutId = null;
          } else {
            try {
              config.remoteStream.addTrack(ev.target);
              pluginHandle.onremotestream(config.remoteStream);
            } catch (e) {
              Sipgateway.error(e);
            }
          }
        };
      };
    }
    if (addTracks && stream) {
      Sipgateway.log("Adding local stream");
      var simulcast =
        (callbacks.simulcast === true || callbacks.simulcast2 === true) &&
        Sipgateway.unifiedPlan;
      var svc = callbacks.svc;
      stream.getTracks().forEach(function (track) {
        Sipgateway.log("Adding local track:", track);
        var sender = null;
        if ((!simulcast && !svc) || track.kind === "audio") {
          sender = config.pc.addTrack(track, stream);
        } else if (simulcast) {
          Sipgateway.log("Enabling rid-based simulcasting:", track);
          let maxBitrates = getMaxBitrates(callbacks.simulcastMaxBitrates);
          let tr = config.pc.addTransceiver(track, {
            direction: "sendrecv",
            streams: [stream],
            sendEncodings: callbacks.sendEncodings || [
              { rid: "h", active: true, maxBitrate: maxBitrates.high },
              {
                rid: "m",
                active: true,
                maxBitrate: maxBitrates.medium,
                scaleResolutionDownBy: 2,
              },
              {
                rid: "l",
                active: true,
                maxBitrate: maxBitrates.low,
                scaleResolutionDownBy: 4,
              },
            ],
          });
          if (tr) sender = tr.sender;
        } else {
          Sipgateway.log("Enabling SVC (" + svc + "):", track);
          let tr = config.pc.addTransceiver(track, {
            direction: "sendrecv",
            streams: [stream],
            sendEncodings: [{ scalabilityMode: svc }],
          });
          if (tr) sender = tr.sender;
        }

        if (sender && config.senderTransforms) {
          var senderStreams = null;
          if (RTCRtpSender.prototype.createEncodedStreams) {
            senderStreams = sender.createEncodedStreams();
          } else if (
            RTCRtpSender.prototype.createAudioEncodedStreams ||
            RTCRtpSender.prototype.createEncodedVideoStreams
          ) {
            if (
              sender.track.kind === "audio" &&
              config.senderTransforms["audio"]
            ) {
              senderStreams = sender.createEncodedAudioStreams();
            } else if (
              sender.track.kind === "video" &&
              config.senderTransforms["video"]
            ) {
              senderStreams = sender.createEncodedVideoStreams();
            }
          }
          if (senderStreams) {
            console.log(senderStreams);
            if (senderStreams.readableStream && senderStreams.writableStream) {
              senderStreams.readableStream
                .pipeThrough(config.senderTransforms[sender.track.kind])
                .pipeTo(senderStreams.writableStream);
            } else if (senderStreams.readable && senderStreams.writable) {
              senderStreams.readable
                .pipeThrough(config.senderTransforms[sender.track.kind])
                .pipeTo(senderStreams.writable);
            }
          }
        }
      });
    }

    if (
      isDataEnabled(media) &&
      !config.dataChannel[Sipgateway.dataChanDefaultLabel]
    ) {
      Sipgateway.log("Creating default data channel");
      createDataChannel(handleId, Sipgateway.dataChanDefaultLabel, null, false);
      config.pc.ondatachannel = function (event) {
        Sipgateway.log("Data channel created by Sipgateway:", event);
        createDataChannel(
          handleId,
          event.channel.label,
          event.channel.protocol,
          event.channel
        );
      };
    }

    if (config.myStream) {
      pluginHandle.onlocalstream(config.myStream);
    }

    if (!jsep) {
      createOffer(handleId, media, callbacks);
    } else {
      config.pc.setRemoteDescription(jsep).then(function () {
        Sipgateway.log("Remote description accepted!");
        config.remoteSdp = jsep.sdp;

        if (config.candidates && config.candidates.length > 0) {
          for (var i = 0; i < config.candidates.length; i++) {
            var candidate = config.candidates[i];
            Sipgateway.debug("Adding remote candidate:", candidate);
            if (!candidate || candidate.completed === true) {
              config.pc.addIceCandidate(Sipgateway.endOfCandidates);
            } else {
              config.pc.addIceCandidate(candidate);
            }
          }
          config.candidates = [];
        }

        createAnswer(handleId, media, callbacks);
      }, callbacks.error);
    }
  }
  function prepareWebrtc(handleId, offer, callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : webrtcError;
    var jsep = callbacks.jsep;
    if (offer && jsep) {
      Sipgateway.error("Provided a JSEP to a createOffer");
      callbacks.error("Provided a JSEP to a createOffer");
      return;
    } else if (!offer && (!jsep || !jsep.type || !jsep.sdp)) {
      Sipgateway.error("A valid JSEP is required for createAnswer");
      callbacks.error("A valid JSEP is required for createAnswer");
      return;
    }
    /* Check that callbacks.media is a (not null) Object */
    callbacks.media =
      typeof callbacks.media === "object" && callbacks.media
        ? callbacks.media
        : { audio: true, video: true };
    var media = callbacks.media;
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      callbacks.error("Invalid handle");
      return;
    }
    var config = pluginHandle.webrtcStuff;
    config.trickle = isTrickleEnabled(callbacks.trickle);

    if (!config.pc) {
      media.update = false;
      media.keepAudio = false;
      media.keepVideo = false;
    } else {
      Sipgateway.log("Updating existing media session");
      media.update = true;

      if (callbacks.stream) {
        if (callbacks.stream !== config.myStream) {
          Sipgateway.log("Renegotiation involves a new external stream");
        }
      } else {
        if (media.addAudio) {
          media.keepAudio = false;
          media.replaceAudio = false;
          media.removeAudio = false;
          media.audioSend = true;
          if (
            config.myStream &&
            config.myStream.getAudioTracks() &&
            config.myStream.getAudioTracks().length
          ) {
            Sipgateway.error("Can't add audio stream, there already is one");
            callbacks.error("Can't add audio stream, there already is one");
            return;
          }
        } else if (media.removeAudio) {
          media.keepAudio = false;
          media.replaceAudio = false;
          media.addAudio = false;
          media.audioSend = false;
        } else if (media.replaceAudio) {
          media.keepAudio = false;
          media.addAudio = false;
          media.removeAudio = false;
          media.audioSend = true;
        }
        if (!config.myStream) {
          if (media.replaceAudio) {
            media.keepAudio = false;
            media.replaceAudio = false;
            media.addAudio = true;
            media.audioSend = true;
          }
          if (isAudioSendEnabled(media)) {
            media.keepAudio = false;
            media.addAudio = true;
          }
        } else {
          if (
            !config.myStream.getAudioTracks() ||
            config.myStream.getAudioTracks().length === 0
          ) {
            if (media.replaceAudio) {
              media.keepAudio = false;
              media.replaceAudio = false;
              media.addAudio = true;
              media.audioSend = true;
            }
            if (isAudioSendEnabled(media)) {
              media.keepAudio = false;
              media.addAudio = true;
            }
          } else {
            if (
              isAudioSendEnabled(media) &&
              !media.removeAudio &&
              !media.replaceAudio
            ) {
              media.keepAudio = true;
            }
          }
        }

        if (media.addVideo) {
          media.keepVideo = false;
          media.replaceVideo = false;
          media.removeVideo = false;
          media.videoSend = true;
          if (
            config.myStream &&
            config.myStream.getVideoTracks() &&
            config.myStream.getVideoTracks().length
          ) {
            Sipgateway.error("Can't add video stream, there already is one");
            callbacks.error("Can't add video stream, there already is one");
            return;
          }
        } else if (media.removeVideo) {
          media.keepVideo = false;
          media.replaceVideo = false;
          media.addVideo = false;
          media.videoSend = false;
        } else if (media.replaceVideo) {
          media.keepVideo = false;
          media.addVideo = false;
          media.removeVideo = false;
          media.videoSend = true;
        }
        if (!config.myStream) {
          if (media.replaceVideo) {
            media.keepVideo = false;
            media.replaceVideo = false;
            media.addVideo = true;
            media.videoSend = true;
          }
          if (isVideoSendEnabled(media)) {
            media.keepVideo = false;
            media.addVideo = true;
          }
        } else {
          if (
            !config.myStream.getVideoTracks() ||
            config.myStream.getVideoTracks().length === 0
          ) {
            if (media.replaceVideo) {
              media.keepVideo = false;
              media.replaceVideo = false;
              media.addVideo = true;
              media.videoSend = true;
            }
            if (isVideoSendEnabled(media)) {
              media.keepVideo = false;
              media.addVideo = true;
            }
          } else {
            if (
              isVideoSendEnabled(media) &&
              !media.removeVideo &&
              !media.replaceVideo
            ) {
              media.keepVideo = true;
            }
          }
        }

        if (media.addData) {
          media.data = true;
        }
      }

      if (
        isAudioSendEnabled(media) &&
        media.keepAudio &&
        isVideoSendEnabled(media) &&
        media.keepVideo
      ) {
        pluginHandle.consentDialog(false);
        streamsDone(handleId, jsep, media, callbacks, config.myStream);
        return;
      }
    }

    if (
      media.update &&
      (!config.streamExternal ||
        (config.streamExternal && (media.replaceAudio || media.replaceVideo)))
    ) {
      if (media.removeAudio || media.replaceAudio) {
        if (
          config.myStream &&
          config.myStream.getAudioTracks() &&
          config.myStream.getAudioTracks().length
        ) {
          var at = config.myStream.getAudioTracks()[0];
          Sipgateway.log("Removing audio track:", at);
          config.myStream.removeTrack(at);
          try {
            at.stop();
          } catch (e) {}
        }
        if (config.pc.getSenders() && config.pc.getSenders().length) {
          var ra = true;
          if (media.replaceAudio && Sipgateway.unifiedPlan) {
            ra = false;
          }
          if (ra) {
            for (var asnd of config.pc.getSenders()) {
              if (asnd && asnd.track && asnd.track.kind === "audio") {
                Sipgateway.log("Removing audio sender:", asnd);
                config.pc.removeTrack(asnd);
              }
            }
          }
        }
      }
      if (media.removeVideo || media.replaceVideo) {
        if (
          config.myStream &&
          config.myStream.getVideoTracks() &&
          config.myStream.getVideoTracks().length
        ) {
          var vt = config.myStream.getVideoTracks()[0];
          Sipgateway.log("Removing video track:", vt);
          config.myStream.removeTrack(vt);
          try {
            vt.stop();
          } catch (e) {}
        }
        if (config.pc.getSenders() && config.pc.getSenders().length) {
          var rv = true;
          if (media.replaceVideo && Sipgateway.unifiedPlan) {
            rv = false;
          }
          if (rv) {
            for (var vsnd of config.pc.getSenders()) {
              if (vsnd && vsnd.track && vsnd.track.kind === "video") {
                Sipgateway.log("Removing video sender:", vsnd);
                config.pc.removeTrack(vsnd);
              }
            }
          }
        }
      }
    }

    if (callbacks.stream) {
      var stream = callbacks.stream;
      Sipgateway.log("MediaStream provided by the application");
      Sipgateway.debug(stream);

      if (
        media.update &&
        config.myStream &&
        config.myStream !== callbacks.stream &&
        !config.streamExternal &&
        !media.replaceAudio &&
        !media.replaceVideo
      ) {
        Sipgateway.stopAllTracks(config.myStream);
        config.myStream = null;
      }

      config.streamExternal = true;
      pluginHandle.consentDialog(false);
      streamsDone(handleId, jsep, media, callbacks, stream);
      return;
    }
    if (isAudioSendEnabled(media) || isVideoSendEnabled(media)) {
      if (!Sipgateway.isGetUserMediaAvailable()) {
        callbacks.error("getUserMedia not available");
        return;
      }
      var constraints = { mandatory: {}, optional: [] };
      pluginHandle.consentDialog(true);
      var audioSupport = isAudioSendEnabled(media);
      if (audioSupport && media && typeof media.audio === "object")
        audioSupport = media.audio;
      var videoSupport = isVideoSendEnabled(media);
      if (videoSupport && media) {
        var simulcast =
          callbacks.simulcast === true || callbacks.simulcast2 === true;
        var svc = callbacks.svc;
        if ((simulcast || svc) && !jsep && !media.video) media.video = "hires";
        if (media.video && media.video != "screen" && media.video != "window") {
          if (typeof media.video === "object") {
            videoSupport = media.video;
          } else {
            var width = 0;
            var height = 0;
            if (media.video === "lowres") {
              height = 240;
              width = 320;
            } else if (media.video === "lowres-16:9") {
              height = 180;
              width = 320;
            } else if (
              media.video === "hires" ||
              media.video === "hires-16:9" ||
              media.video === "hdres"
            ) {
              height = 720;
              width = 1280;
            } else if (media.video === "fhdres") {
              height = 1080;
              width = 1920;
            } else if (media.video === "4kres") {
              height = 2160;
              width = 3840;
            } else if (media.video === "stdres") {
              height = 480;
              width = 640;
            } else if (media.video === "stdres-16:9") {
              height = 360;
              width = 640;
            } else {
              Sipgateway.log("Default video setting is stdres 4:3");
              height = 480;
              width = 640;
            }
            Sipgateway.log("Adding media constraint:", media.video);
            videoSupport = {
              height: { ideal: height },
              width: { ideal: width },
            };
            Sipgateway.log("Adding video constraint:", videoSupport);
          }
        } else if (media.video === "screen" || media.video === "window") {
          if (
            navigator.mediaDevices &&
            navigator.mediaDevices.getDisplayMedia
          ) {
            constraints.video = {};
            if (media.screenshareFrameRate) {
              constraints.video.frameRate = media.screenshareFrameRate;
            }
            if (media.screenshareHeight) {
              constraints.video.height = media.screenshareHeight;
            }
            if (media.screenshareWidth) {
              constraints.video.width = media.screenshareWidth;
            }
            constraints.audio = media.captureDesktopAudio;
            navigator.mediaDevices.getDisplayMedia(constraints).then(
              function (stream) {
                pluginHandle.consentDialog(false);
                if (isAudioSendEnabled(media) && !media.keepAudio) {
                  navigator.mediaDevices
                    .getUserMedia({ audio: true, video: false })
                    .then(function (audioStream) {
                      stream.addTrack(audioStream.getAudioTracks()[0]);
                      streamsDone(handleId, jsep, media, callbacks, stream);
                    });
                } else {
                  streamsDone(handleId, jsep, media, callbacks, stream);
                }
              },
              function (error) {
                pluginHandle.consentDialog(false);
                callbacks.error(error);
              }
            );
            return;
          }

          const callbackUserMedia = function (error, stream) {
            pluginHandle.consentDialog(false);
            if (error) {
              callbacks.error(error);
            } else {
              streamsDone(handleId, jsep, media, callbacks, stream);
            }
          };
          const getScreenMedia = function (constraints, gsmCallback, useAudio) {
            Sipgateway.log("Adding media constraint (screen capture)");
            Sipgateway.debug(constraints);
            navigator.mediaDevices
              .getUserMedia(constraints)
              .then(function (stream) {
                if (useAudio) {
                  navigator.mediaDevices
                    .getUserMedia({ audio: true, video: false })
                    .then(function (audioStream) {
                      stream.addTrack(audioStream.getAudioTracks()[0]);
                      gsmCallback(null, stream);
                    });
                } else {
                  gsmCallback(null, stream);
                }
              })
              .catch(function (error) {
                pluginHandle.consentDialog(false);
                gsmCallback(error);
              });
          };
          if (Sipgateway.webRTCAdapter.browserDetails.browser === "chrome") {
            var chromever = Sipgateway.webRTCAdapter.browserDetails.version;
            var maxver = 33;
            if (window.navigator.userAgent.match("Linux")) maxver = 35;
            if (chromever >= 26 && chromever <= maxver) {
              constraints = {
                video: {
                  mandatory: {
                    googLeakyBucket: true,
                    maxWidth: window.screen.width,
                    maxHeight: window.screen.height,
                    minFrameRate: media.screenshareFrameRate,
                    maxFrameRate: media.screenshareFrameRate,
                    chromeMediaSource: "screen",
                  },
                },
                audio: isAudioSendEnabled(media) && !media.keepAudio,
              };
              getScreenMedia(constraints, callbackUserMedia);
            } else {
              Sipgateway.extension.getScreen(function (error, sourceId) {
                if (error) {
                  pluginHandle.consentDialog(false);
                  return callbacks.error(error);
                }
                constraints = {
                  audio: false,
                  video: {
                    mandatory: {
                      chromeMediaSource: "desktop",
                      maxWidth: window.screen.width,
                      maxHeight: window.screen.height,
                      minFrameRate: media.screenshareFrameRate,
                      maxFrameRate: media.screenshareFrameRate,
                    },
                    optional: [
                      { googLeakyBucket: true },
                      { googTemporalLayeredScreencast: true },
                    ],
                  },
                };
                constraints.video.mandatory.chromeMediaSourceId = sourceId;
                getScreenMedia(
                  constraints,
                  callbackUserMedia,
                  isAudioSendEnabled(media) && !media.keepAudio
                );
              });
            }
          } else if (
            Sipgateway.webRTCAdapter.browserDetails.browser === "firefox"
          ) {
            if (Sipgateway.webRTCAdapter.browserDetails.version >= 33) {
              constraints = {
                video: {
                  mozMediaSource: media.video,
                  mediaSource: media.video,
                },
                audio: isAudioSendEnabled(media) && !media.keepAudio,
              };
              getScreenMedia(constraints, function (err, stream) {
                callbackUserMedia(err, stream);

                if (!err) {
                  var lastTime = stream.currentTime;
                  var polly = window.setInterval(function () {
                    if (!stream) window.clearInterval(polly);
                    if (stream.currentTime == lastTime) {
                      window.clearInterval(polly);
                      if (stream.onended) {
                        stream.onended();
                      }
                    }
                    lastTime = stream.currentTime;
                  }, 500);
                }
              });
            } else {
              var error = new Error("NavigatorUserMediaError");
              error.name =
                "Your version of Firefox does not support screen sharing, please install Firefox 33 (or more recent versions)";
              pluginHandle.consentDialog(false);
              callbacks.error(error);
              return;
            }
          }
          return;
        }
      }

      if (!media || media.video !== "screen") {
        navigator.mediaDevices
          .enumerateDevices()
          .then(function (devices) {
            var audioExist = devices.some(function (device) {
                return device.kind === "audioinput";
              }),
              videoExist =
                isScreenSendEnabled(media) ||
                devices.some(function (device) {
                  return device.kind === "videoinput";
                });

            var audioSend = isAudioSendEnabled(media);
            var videoSend = isVideoSendEnabled(media);
            var needAudioDevice = isAudioSendRequired(media);
            var needVideoDevice = isVideoSendRequired(media);
            if (audioSend || videoSend || needAudioDevice || needVideoDevice) {
              var haveAudioDevice = audioSend ? audioExist : false;
              var haveVideoDevice = videoSend ? videoExist : false;
              if (!haveAudioDevice && !haveVideoDevice) {
                pluginHandle.consentDialog(false);
                callbacks.error("No capture device found");
                return false;
              } else if (!haveAudioDevice && needAudioDevice) {
                pluginHandle.consentDialog(false);
                callbacks.error(
                  "Audio capture is required, but no capture device found"
                );
                return false;
              } else if (!haveVideoDevice && needVideoDevice) {
                pluginHandle.consentDialog(false);
                callbacks.error(
                  "Video capture is required, but no capture device found"
                );
                return false;
              }
            }
            var gumConstraints = {
              audio: audioExist && !media.keepAudio ? audioSupport : false,
              video: videoExist && !media.keepVideo ? videoSupport : false,
            };
            Sipgateway.debug("getUserMedia constraints", gumConstraints);
            if (!gumConstraints.audio && !gumConstraints.video) {
              pluginHandle.consentDialog(false);
              streamsDone(handleId, jsep, media, callbacks, stream);
            } else {
              navigator.mediaDevices
                .getUserMedia(gumConstraints)
                .then(function (stream) {
                  pluginHandle.consentDialog(false);
                  streamsDone(handleId, jsep, media, callbacks, stream);
                })
                .catch(function (error) {
                  pluginHandle.consentDialog(false);
                  callbacks.error({
                    code: error.code,
                    name: error.name,
                    message: error.message,
                  });
                });
            }
          })
          .catch(function (error) {
            pluginHandle.consentDialog(false);
            callbacks.error(error);
          });
      }
    } else {
      streamsDone(handleId, jsep, media, callbacks);
    }
  }
  function prepareWebrtcPeer(handleId, callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : webrtcError;
    callbacks.customizeSdp =
      typeof callbacks.customizeSdp == "function"
        ? callbacks.customizeSdp
        : Sipgateway.noop;
    var jsep = callbacks.jsep;
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      callbacks.error("Invalid handle");
      return;
    }
    var config = pluginHandle.webrtcStuff;
    if (jsep) {
      if (!config.pc) {
        Sipgateway.warn(
          "Wait, no PeerConnection?? if this is an answer, use createAnswer and not handleRemoteJsep"
        );
        callbacks.error(
          "No PeerConnection: if this is an answer, use createAnswer and not handleRemoteJsep"
        );
        return;
      }
      callbacks.customizeSdp(jsep);
      config.pc.setRemoteDescription(jsep).then(function () {
        Sipgateway.log("Remote description accepted!");
        config.remoteSdp = jsep.sdp;

        if (config.candidates && config.candidates.length > 0) {
          for (var i = 0; i < config.candidates.length; i++) {
            var candidate = config.candidates[i];
            Sipgateway.debug("Adding remote candidate:", candidate);
            if (!candidate || candidate.completed === true) {
              config.pc.addIceCandidate(Sipgateway.endOfCandidates);
            } else {
              config.pc.addIceCandidate(candidate);
            }
          }
          config.candidates = [];
        }

        callbacks.success();
      }, callbacks.error);
    } else {
      callbacks.error("Invalid JSEP");
    }
  }
  function createOffer(handleId, media, callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    callbacks.customizeSdp =
      typeof callbacks.customizeSdp == "function"
        ? callbacks.customizeSdp
        : Sipgateway.noop;
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      callbacks.error("Invalid handle");
      return;
    }
    var config = pluginHandle.webrtcStuff;
    var simulcast = callbacks.simulcast === true;
    if (!simulcast) {
      Sipgateway.log("Creating offer (iceDone=" + config.iceDone + ")");
    } else {
      Sipgateway.log(
        "Creating offer (iceDone=" +
          config.iceDone +
          ", simulcast=" +
          simulcast +
          ")"
      );
    }

    var mediaConstraints = {};
    if (Sipgateway.unifiedPlan) {
      var audioTransceiver = null,
        videoTransceiver = null;
      var transceivers = config.pc.getTransceivers();
      if (transceivers && transceivers.length > 0) {
        for (var t of transceivers) {
          if (
            (t.sender && t.sender.track && t.sender.track.kind === "audio") ||
            (t.receiver &&
              t.receiver.track &&
              t.receiver.track.kind === "audio")
          ) {
            if (!audioTransceiver) {
              audioTransceiver = t;
            }
            continue;
          }
          if (
            (t.sender && t.sender.track && t.sender.track.kind === "video") ||
            (t.receiver &&
              t.receiver.track &&
              t.receiver.track.kind === "video")
          ) {
            if (!videoTransceiver) {
              videoTransceiver = t;
            }
            continue;
          }
        }
      }

      var audioSend = isAudioSendEnabled(media);
      var audioRecv = isAudioRecvEnabled(media);
      if (!audioSend && !audioRecv) {
        if (media.removeAudio && audioTransceiver) {
          if (audioTransceiver.setDirection) {
            audioTransceiver.setDirection("inactive");
          } else {
            audioTransceiver.direction = "inactive";
          }
          Sipgateway.log(
            "Setting audio transceiver to inactive:",
            audioTransceiver
          );
        }
      } else {
        if (audioSend && audioRecv) {
          if (audioTransceiver) {
            if (audioTransceiver.setDirection) {
              audioTransceiver.setDirection("sendrecv");
            } else {
              audioTransceiver.direction = "sendrecv";
            }
            Sipgateway.log(
              "Setting audio transceiver to sendrecv:",
              audioTransceiver
            );
          }
        } else if (audioSend && !audioRecv) {
          if (audioTransceiver) {
            if (audioTransceiver.setDirection) {
              audioTransceiver.setDirection("sendonly");
            } else {
              audioTransceiver.direction = "sendonly";
            }
            Sipgateway.log(
              "Setting audio transceiver to sendonly:",
              audioTransceiver
            );
          }
        } else if (!audioSend && audioRecv) {
          if (audioTransceiver) {
            if (audioTransceiver.setDirection) {
              audioTransceiver.setDirection("recvonly");
            } else {
              audioTransceiver.direction = "recvonly";
            }
            Sipgateway.log(
              "Setting audio transceiver to recvonly:",
              audioTransceiver
            );
          } else {
            audioTransceiver = config.pc.addTransceiver("audio", {
              direction: "recvonly",
            });
            Sipgateway.log(
              "Adding recvonly audio transceiver:",
              audioTransceiver
            );
          }
        }
      }

      var videoSend = isVideoSendEnabled(media);
      var videoRecv = isVideoRecvEnabled(media);
      if (!videoSend && !videoRecv) {
        if (media.removeVideo && videoTransceiver) {
          if (videoTransceiver.setDirection) {
            videoTransceiver.setDirection("inactive");
          } else {
            videoTransceiver.direction = "inactive";
          }
          Sipgateway.log(
            "Setting video transceiver to inactive:",
            videoTransceiver
          );
        }
      } else {
        if (videoSend && videoRecv) {
          if (videoTransceiver) {
            if (videoTransceiver.setDirection) {
              videoTransceiver.setDirection("sendrecv");
            } else {
              videoTransceiver.direction = "sendrecv";
            }
            Sipgateway.log(
              "Setting video transceiver to sendrecv:",
              videoTransceiver
            );
          }
        } else if (videoSend && !videoRecv) {
          if (videoTransceiver) {
            if (videoTransceiver.setDirection) {
              videoTransceiver.setDirection("sendonly");
            } else {
              videoTransceiver.direction = "sendonly";
            }
            Sipgateway.log(
              "Setting video transceiver to sendonly:",
              videoTransceiver
            );
          }
        } else if (!videoSend && videoRecv) {
          if (videoTransceiver) {
            if (videoTransceiver.setDirection) {
              videoTransceiver.setDirection("recvonly");
            } else {
              videoTransceiver.direction = "recvonly";
            }
            Sipgateway.log(
              "Setting video transceiver to recvonly:",
              videoTransceiver
            );
          } else {
            videoTransceiver = config.pc.addTransceiver("video", {
              direction: "recvonly",
            });
            Sipgateway.log(
              "Adding recvonly video transceiver:",
              videoTransceiver
            );
          }
        }
      }
    } else {
      mediaConstraints["offerToReceiveAudio"] = isAudioRecvEnabled(media);
      mediaConstraints["offerToReceiveVideo"] = isVideoRecvEnabled(media);
    }
    var iceRestart = callbacks.iceRestart === true;
    if (iceRestart) {
      mediaConstraints["iceRestart"] = true;
    }
    Sipgateway.debug(mediaConstraints);

    var sendVideo = isVideoSendEnabled(media);
    if (
      sendVideo &&
      simulcast &&
      Sipgateway.webRTCAdapter.browserDetails.browser === "firefox"
    ) {
      Sipgateway.log("Enabling Simulcasting for Firefox (RID)");
      var sender = config.pc.getSenders().find(function (s) {
        return s.track && s.track.kind === "video";
      });
      if (sender) {
        var parameters = sender.getParameters();
        if (!parameters) {
          parameters = {};
        }
        var maxBitrates = getMaxBitrates(callbacks.simulcastMaxBitrates);
        parameters.encodings = callbacks.sendEncodings || [
          { rid: "h", active: true, maxBitrate: maxBitrates.high },
          {
            rid: "m",
            active: true,
            maxBitrate: maxBitrates.medium,
            scaleResolutionDownBy: 2,
          },
          {
            rid: "l",
            active: true,
            maxBitrate: maxBitrates.low,
            scaleResolutionDownBy: 4,
          },
        ];
        sender.setParameters(parameters);
      }
    }
    config.pc.createOffer(mediaConstraints).then(function (offer) {
      Sipgateway.debug(offer);

      var jsep = {
        type: offer.type,
        sdp: offer.sdp,
      };
      callbacks.customizeSdp(jsep);
      offer.sdp = jsep.sdp;
      Sipgateway.log("Setting local description");
      if (sendVideo && simulcast && !Sipgateway.unifiedPlan) {
        if (
          Sipgateway.webRTCAdapter.browserDetails.browser === "chrome" ||
          Sipgateway.webRTCAdapter.browserDetails.browser === "safari"
        ) {
          Sipgateway.log("Enabling Simulcasting for Chrome (SDP munging)");
          offer.sdp = mungeSdpForSimulcasting(offer.sdp);
        }
      }
      config.mySdp = {
        type: "offer",
        sdp: offer.sdp,
      };
      config.pc.setLocalDescription(offer).catch(callbacks.error);
      config.mediaConstraints = mediaConstraints;
      if (!config.iceDone && !config.trickle) {
        Sipgateway.log("Waiting for all candidates...");
        return;
      }

      if (config.senderTransforms || config.receiverTransforms) {
        offer["e2ee"] = true;
      }
      callbacks.success(offer);
    }, callbacks.error);
  }
  function createAnswer(handleId, media, callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    callbacks.customizeSdp =
      typeof callbacks.customizeSdp == "function"
        ? callbacks.customizeSdp
        : Sipgateway.noop;
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      callbacks.error("Invalid handle");
      return;
    }
    var config = pluginHandle.webrtcStuff;
    var simulcast =
      callbacks.simulcast === true || callbacks.simulcast2 === true;
    if (!simulcast) {
      Sipgateway.log("Creating answer (iceDone=" + config.iceDone + ")");
    } else {
      Sipgateway.log(
        "Creating answer (iceDone=" +
          config.iceDone +
          ", simulcast=" +
          simulcast +
          ")"
      );
    }
    var mediaConstraints = null;
    if (Sipgateway.unifiedPlan) {
      mediaConstraints = {};
      var audioTransceiver = null,
        videoTransceiver = null;
      var transceivers = config.pc.getTransceivers();
      if (transceivers && transceivers.length > 0) {
        for (var t of transceivers) {
          if (
            (t.sender && t.sender.track && t.sender.track.kind === "audio") ||
            (t.receiver &&
              t.receiver.track &&
              t.receiver.track.kind === "audio")
          ) {
            if (!audioTransceiver) audioTransceiver = t;
            continue;
          }
          if (
            (t.sender && t.sender.track && t.sender.track.kind === "video") ||
            (t.receiver &&
              t.receiver.track &&
              t.receiver.track.kind === "video")
          ) {
            if (!videoTransceiver) videoTransceiver = t;
            continue;
          }
        }
      }

      var audioSend = isAudioSendEnabled(media);
      var audioRecv = isAudioRecvEnabled(media);
      if (!audioSend && !audioRecv) {
        if (media.removeAudio && audioTransceiver) {
          try {
            if (audioTransceiver.setDirection) {
              audioTransceiver.setDirection("inactive");
            } else {
              audioTransceiver.direction = "inactive";
            }
            Sipgateway.log(
              "Setting audio transceiver to inactive:",
              audioTransceiver
            );
          } catch (e) {
            Sipgateway.error(e);
          }
        }
      } else {
        if (audioSend && audioRecv) {
          if (audioTransceiver) {
            try {
              if (audioTransceiver.setDirection) {
                audioTransceiver.setDirection("sendrecv");
              } else {
                audioTransceiver.direction = "sendrecv";
              }
              Sipgateway.log(
                "Setting audio transceiver to sendrecv:",
                audioTransceiver
              );
            } catch (e) {
              Sipgateway.error(e);
            }
          }
        } else if (audioSend && !audioRecv) {
          try {
            if (audioTransceiver) {
              if (audioTransceiver.setDirection) {
                audioTransceiver.setDirection("sendonly");
              } else {
                audioTransceiver.direction = "sendonly";
              }
              Sipgateway.log(
                "Setting audio transceiver to sendonly:",
                audioTransceiver
              );
            }
          } catch (e) {
            Sipgateway.error(e);
          }
        } else if (!audioSend && audioRecv) {
          if (audioTransceiver) {
            try {
              if (audioTransceiver.setDirection) {
                audioTransceiver.setDirection("recvonly");
              } else {
                audioTransceiver.direction = "recvonly";
              }
              Sipgateway.log(
                "Setting audio transceiver to recvonly:",
                audioTransceiver
              );
            } catch (e) {
              Sipgateway.error(e);
            }
          } else {
            audioTransceiver = config.pc.addTransceiver("audio", {
              direction: "recvonly",
            });
            Sipgateway.log(
              "Adding recvonly audio transceiver:",
              audioTransceiver
            );
          }
        }
      }

      var videoSend = isVideoSendEnabled(media);
      var videoRecv = isVideoRecvEnabled(media);
      if (!videoSend && !videoRecv) {
        if (media.removeVideo && videoTransceiver) {
          try {
            if (videoTransceiver.setDirection) {
              videoTransceiver.setDirection("inactive");
            } else {
              videoTransceiver.direction = "inactive";
            }
            Sipgateway.log(
              "Setting video transceiver to inactive:",
              videoTransceiver
            );
          } catch (e) {
            Sipgateway.error(e);
          }
        }
      } else {
        if (videoSend && videoRecv) {
          if (videoTransceiver) {
            try {
              if (videoTransceiver.setDirection) {
                videoTransceiver.setDirection("sendrecv");
              } else {
                videoTransceiver.direction = "sendrecv";
              }
              Sipgateway.log(
                "Setting video transceiver to sendrecv:",
                videoTransceiver
              );
            } catch (e) {
              Sipgateway.error(e);
            }
          }
        } else if (videoSend && !videoRecv) {
          if (videoTransceiver) {
            try {
              if (videoTransceiver.setDirection) {
                videoTransceiver.setDirection("sendonly");
              } else {
                videoTransceiver.direction = "sendonly";
              }
              Sipgateway.log(
                "Setting video transceiver to sendonly:",
                videoTransceiver
              );
            } catch (e) {
              Sipgateway.error(e);
            }
          }
        } else if (!videoSend && videoRecv) {
          if (videoTransceiver) {
            try {
              if (videoTransceiver.setDirection) {
                videoTransceiver.setDirection("recvonly");
              } else {
                videoTransceiver.direction = "recvonly";
              }
              Sipgateway.log(
                "Setting video transceiver to recvonly:",
                videoTransceiver
              );
            } catch (e) {
              Sipgateway.error(e);
            }
          } else {
            videoTransceiver = config.pc.addTransceiver("video", {
              direction: "recvonly",
            });
            Sipgateway.log(
              "Adding recvonly video transceiver:",
              videoTransceiver
            );
          }
        }
      }
    } else {
      if (
        Sipgateway.webRTCAdapter.browserDetails.browser === "firefox" ||
        Sipgateway.webRTCAdapter.browserDetails.browser === "edge"
      ) {
        mediaConstraints = {
          offerToReceiveAudio: isAudioRecvEnabled(media),
          offerToReceiveVideo: isVideoRecvEnabled(media),
        };
      } else {
        mediaConstraints = {
          mandatory: {
            OfferToReceiveAudio: isAudioRecvEnabled(media),
            OfferToReceiveVideo: isVideoRecvEnabled(media),
          },
        };
      }
    }
    Sipgateway.debug(mediaConstraints);

    var sendVideo = isVideoSendEnabled(media);
    if (
      sendVideo &&
      simulcast &&
      Sipgateway.webRTCAdapter.browserDetails.browser === "firefox"
    ) {
      Sipgateway.log("Enabling Simulcasting for Firefox (RID)");
      var sender = config.pc.getSenders()[1];
      Sipgateway.log(sender);
      var parameters = sender.getParameters();
      Sipgateway.log(parameters);
      var maxBitrates = getMaxBitrates(callbacks.simulcastMaxBitrates);
      sender.setParameters({
        encodings: callbacks.sendEncodings || [
          { rid: "h", active: true, maxBitrate: maxBitrates.high },
          {
            rid: "m",
            active: true,
            maxBitrate: maxBitrates.medium,
            scaleResolutionDownBy: 2,
          },
          {
            rid: "l",
            active: true,
            maxBitrate: maxBitrates.low,
            scaleResolutionDownBy: 4,
          },
        ],
      });
    }
    config.pc.createAnswer(mediaConstraints).then(function (answer) {
      Sipgateway.debug(answer);

      var jsep = {
        type: answer.type,
        sdp: answer.sdp,
      };
      callbacks.customizeSdp(jsep);
      answer.sdp = jsep.sdp;
      Sipgateway.log("Setting local description");
      if (sendVideo && simulcast && !Sipgateway.unifiedPlan) {
        if (Sipgateway.webRTCAdapter.browserDetails.browser === "chrome") {
          //~ Sipgateway.log("Enabling Simulcasting for Chrome (SDP munging)");
          //~ answer.sdp = mungeSdpForSimulcasting(answer.sdp);
          Sipgateway.warn(
            "simulcast=true, but this is an answer, and video breaks in Chrome if we enable it"
          );
        }
      }
      config.mySdp = {
        type: "answer",
        sdp: answer.sdp,
      };
      config.pc.setLocalDescription(answer).catch(callbacks.error);
      config.mediaConstraints = mediaConstraints;
      if (!config.iceDone && !config.trickle) {
        Sipgateway.log("Waiting for all candidates...");
        return;
      }

      if (config.senderTransforms || config.receiverTransforms) {
        answer["e2ee"] = true;
      }
      callbacks.success(answer);
    }, callbacks.error);
  }
  function sendSDP(handleId, callbacks) {
    callbacks = callbacks || {};
    callbacks.success =
      typeof callbacks.success == "function"
        ? callbacks.success
        : Sipgateway.noop;
    callbacks.error =
      typeof callbacks.error == "function" ? callbacks.error : Sipgateway.noop;
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle, not sending anything");
      return;
    }
    var config = pluginHandle.webrtcStuff;
    Sipgateway.log("Sending offer/answer SDP...");
    if (!config.mySdp) {
      Sipgateway.warn("Local SDP instance is invalid, not sending anything...");
      return;
    }
    config.mySdp = {
      type: config.pc.localDescription.type,
      sdp: config.pc.localDescription.sdp,
    };
    if (config.trickle === false) config.mySdp["trickle"] = false;
    Sipgateway.debug(callbacks);
    config.sdpSent = true;
    callbacks.success(config.mySdp);
  }
  function getVolume(handleId, remote) {
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      return 0;
    }
    var stream = remote ? "remote" : "local";
    var config = pluginHandle.webrtcStuff;
    if (!config.volume[stream]) config.volume[stream] = { value: 0 };

    if (
      config.pc.getStats &&
      (Sipgateway.webRTCAdapter.browserDetails.browser === "chrome" ||
        Sipgateway.webRTCAdapter.browserDetails.browser === "safari")
    ) {
      if (remote && !config.remoteStream) {
        Sipgateway.warn("Remote stream unavailable");
        return 0;
      } else if (!remote && !config.myStream) {
        Sipgateway.warn("Local stream unavailable");
        return 0;
      }
      if (!config.volume[stream].timer) {
        Sipgateway.log("Starting " + stream + " volume monitor");
        config.volume[stream].timer = setInterval(function () {
          config.pc.getStats().then(function (stats) {
            stats.forEach(function (res) {
              if (!res || res.kind !== "audio") return;
              if (
                (remote && !res.remoteSource) ||
                (!remote && res.type !== "media-source")
              )
                return;
              config.volume[stream].value = res.audioLevel ? res.audioLevel : 0;
            });
          });
        }, 200);
        return 0;
      }
      return config.volume[stream].value;
    } else {
      Sipgateway.warn(
        "Getting the " + stream + " volume unsupported by browser"
      );
      return 0;
    }
  }
  function isMuted(handleId, video) {
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      return true;
    }
    var config = pluginHandle.webrtcStuff;
    if (!config.pc) {
      Sipgateway.warn("Invalid PeerConnection");
      return true;
    }
    if (!config.myStream) {
      Sipgateway.warn("Invalid local MediaStream");
      return true;
    }
    if (video) {
      if (
        !config.myStream.getVideoTracks() ||
        config.myStream.getVideoTracks().length === 0
      ) {
        Sipgateway.warn("No video track");
        return true;
      }
      return !config.myStream.getVideoTracks()[0].enabled;
    } else {
      if (
        !config.myStream.getAudioTracks() ||
        config.myStream.getAudioTracks().length === 0
      ) {
        Sipgateway.warn("No audio track");
        return true;
      }
      return !config.myStream.getAudioTracks()[0].enabled;
    }
  }
  function mute(handleId, video, mute) {
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      return false;
    }
    var config = pluginHandle.webrtcStuff;
    if (!config.pc) {
      Sipgateway.warn("Invalid PeerConnection");
      return false;
    }
    if (!config.myStream) {
      Sipgateway.warn("Invalid local MediaStream");
      return false;
    }
    if (video) {
      if (
        !config.myStream.getVideoTracks() ||
        config.myStream.getVideoTracks().length === 0
      ) {
        Sipgateway.warn("No video track");
        return false;
      }
      config.myStream.getVideoTracks()[0].enabled = !mute;
      return true;
    } else {
      if (
        !config.myStream.getAudioTracks() ||
        config.myStream.getAudioTracks().length === 0
      ) {
        Sipgateway.warn("No audio track");
        return false;
      }
      config.myStream.getAudioTracks()[0].enabled = !mute;
      return true;
    }
  }
  function getBitrate(handleId) {
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle || !pluginHandle.webrtcStuff) {
      Sipgateway.warn("Invalid handle");
      return "Invalid handle";
    }
    var config = pluginHandle.webrtcStuff;
    if (!config.pc) return "Invalid PeerConnection";

    if (config.pc.getStats) {
      if (!config.bitrate.timer) {
        Sipgateway.log("Starting bitrate timer (via getStats)");
        config.bitrate.timer = setInterval(function () {
          config.pc.getStats().then(function (stats) {
            stats.forEach(function (res) {
              if (!res) return;
              var inStats = false;

              if (
                (res.mediaType === "video" ||
                  res.id.toLowerCase().indexOf("video") > -1) &&
                res.type === "inbound-rtp" &&
                res.id.indexOf("rtcp") < 0
              ) {
                inStats = true;
              } else if (
                res.type == "ssrc" &&
                res.bytesReceived &&
                (res.googCodecName === "VP8" || res.googCodecName === "")
              ) {
                inStats = true;
              }

              if (inStats) {
                config.bitrate.bsnow = res.bytesReceived;
                config.bitrate.tsnow = res.timestamp;
                if (
                  config.bitrate.bsbefore === null ||
                  config.bitrate.tsbefore === null
                ) {
                  config.bitrate.bsbefore = config.bitrate.bsnow;
                  config.bitrate.tsbefore = config.bitrate.tsnow;
                } else {
                  var timePassed =
                    config.bitrate.tsnow - config.bitrate.tsbefore;
                  if (
                    Sipgateway.webRTCAdapter.browserDetails.browser === "safari"
                  )
                    timePassed = timePassed / 1000;
                  var bitRate = Math.round(
                    ((config.bitrate.bsnow - config.bitrate.bsbefore) * 8) /
                      timePassed
                  );
                  if (
                    Sipgateway.webRTCAdapter.browserDetails.browser === "safari"
                  )
                    bitRate = parseInt(bitRate / 1000);
                  config.bitrate.value = bitRate + " kbits/sec";
                  //~ Sipgateway.log("Estimated bitrate is " + config.bitrate.value);
                  config.bitrate.bsbefore = config.bitrate.bsnow;
                  config.bitrate.tsbefore = config.bitrate.tsnow;
                }
              }
            });
          });
        }, 1000);
        return "0 kbits/sec";
      }
      return config.bitrate.value;
    } else {
      Sipgateway.warn("Getting the video bitrate unsupported by browser");
      return "Feature unsupported by browser";
    }
  }
  function webrtcError(error) {
    Sipgateway.error("WebRTC error:", error);
  }
  function cleanupWebrtc(handleId, hangupRequest) {
    Sipgateway.log("Cleaning WebRTC stuff");
    var pluginHandle = pluginHandles[handleId];
    if (!pluginHandle) {
      return;
    }
    var config = pluginHandle.webrtcStuff;
    if (config) {
      if (hangupRequest === true) {
        var request = {
          janus: "hangup",
          transaction: Sipgateway.randomString(12),
        };
        if (pluginHandle.token) request["token"] = pluginHandle.token;
        if (apisecret) request["apisecret"] = apisecret;
        Sipgateway.debug("Sending hangup request (handle=" + handleId + "):");
        Sipgateway.debug(request);
        if (websockets) {
          request["session_id"] = sessionId;
          request["handle_id"] = handleId;
          ws.send(JSON.stringify(request));
        } else {
          Sipgateway.httpAPICall(server + "/" + sessionId + "/" + handleId, {
            verb: "POST",
            withCredentials: withCredentials,
            body: request,
          });
        }
      }

      config.remoteStream = null;
      if (config.volume) {
        if (config.volume["local"] && config.volume["local"].timer)
          clearInterval(config.volume["local"].timer);
        if (config.volume["remote"] && config.volume["remote"].timer)
          clearInterval(config.volume["remote"].timer);
      }
      config.volume = {};
      if (config.bitrate.timer) clearInterval(config.bitrate.timer);
      config.bitrate.timer = null;
      config.bitrate.bsnow = null;
      config.bitrate.bsbefore = null;
      config.bitrate.tsnow = null;
      config.bitrate.tsbefore = null;
      config.bitrate.value = null;
      if (!config.streamExternal && config.myStream) {
        Sipgateway.log("Stopping local stream tracks");
        Sipgateway.stopAllTracks(config.myStream);
      }
      config.streamExternal = false;
      config.myStream = null;

      try {
        config.pc.close();
      } catch (e) {}
      config.pc = null;
      config.candidates = null;
      config.mySdp = null;
      config.remoteSdp = null;
      config.iceDone = false;
      config.dataChannel = {};
      config.dtmfSender = null;
      config.senderTransforms = null;
      config.receiverTransforms = null;
    }
    pluginHandle.oncleanup();
  }

  function mungeSdpForSimulcasting(sdp) {
    var lines = sdp.split("\r\n");
    var video = false;
    var ssrc = [-1],
      ssrc_fid = [-1];
    var cname = null,
      msid = null,
      mslabel = null,
      label = null;
    var insertAt = -1;
    for (let i = 0; i < lines.length; i++) {
      const mline = lines[i].match(/m=(\w+) */);
      if (mline) {
        const medium = mline[1];
        if (medium === "video") {
          if (ssrc[0] < 0) {
            video = true;
          } else {
            insertAt = i;
            break;
          }
        } else {
          if (ssrc[0] > -1) {
            insertAt = i;
            break;
          }
        }
        continue;
      }
      if (!video) continue;
      var sim = lines[i].match(/a=ssrc-group:SIM (\d+) (\d+) (\d+)/);
      if (sim) {
        Sipgateway.warn(
          "The SDP already contains a SIM attribute, munging will be skipped"
        );
        return sdp;
      }
      var fid = lines[i].match(/a=ssrc-group:FID (\d+) (\d+)/);
      if (fid) {
        ssrc[0] = fid[1];
        ssrc_fid[0] = fid[2];
        lines.splice(i, 1);
        i--;
        continue;
      }
      if (ssrc[0]) {
        var match = lines[i].match("a=ssrc:" + ssrc[0] + " cname:(.+)");
        if (match) {
          cname = match[1];
        }
        match = lines[i].match("a=ssrc:" + ssrc[0] + " msid:(.+)");
        if (match) {
          msid = match[1];
        }
        match = lines[i].match("a=ssrc:" + ssrc[0] + " mslabel:(.+)");
        if (match) {
          mslabel = match[1];
        }
        match = lines[i].match("a=ssrc:" + ssrc[0] + " label:(.+)");
        if (match) {
          label = match[1];
        }
        if (lines[i].indexOf("a=ssrc:" + ssrc_fid[0]) === 0) {
          lines.splice(i, 1);
          i--;
          continue;
        }
        if (lines[i].indexOf("a=ssrc:" + ssrc[0]) === 0) {
          lines.splice(i, 1);
          i--;
          continue;
        }
      }
      if (lines[i].length == 0) {
        lines.splice(i, 1);
        i--;
        continue;
      }
    }
    if (ssrc[0] < 0) {
      insertAt = -1;
      video = false;
      for (let i = 0; i < lines.length; i++) {
        const mline = lines[i].match(/m=(\w+) */);
        if (mline) {
          const medium = mline[1];
          if (medium === "video") {
            if (ssrc[0] < 0) {
              video = true;
            } else {
              insertAt = i;
              break;
            }
          } else {
            if (ssrc[0] > -1) {
              insertAt = i;
              break;
            }
          }
          continue;
        }
        if (!video) continue;
        if (ssrc[0] < 0) {
          var value = lines[i].match(/a=ssrc:(\d+)/);
          if (value) {
            ssrc[0] = value[1];
            lines.splice(i, 1);
            i--;
            continue;
          }
        } else {
          let match = lines[i].match("a=ssrc:" + ssrc[0] + " cname:(.+)");
          if (match) {
            cname = match[1];
          }
          match = lines[i].match("a=ssrc:" + ssrc[0] + " msid:(.+)");
          if (match) {
            msid = match[1];
          }
          match = lines[i].match("a=ssrc:" + ssrc[0] + " mslabel:(.+)");
          if (match) {
            mslabel = match[1];
          }
          match = lines[i].match("a=ssrc:" + ssrc[0] + " label:(.+)");
          if (match) {
            label = match[1];
          }
          if (lines[i].indexOf("a=ssrc:" + ssrc_fid[0]) === 0) {
            lines.splice(i, 1);
            i--;
            continue;
          }
          if (lines[i].indexOf("a=ssrc:" + ssrc[0]) === 0) {
            lines.splice(i, 1);
            i--;
            continue;
          }
        }
        if (lines[i].length === 0) {
          lines.splice(i, 1);
          i--;
          continue;
        }
      }
    }
    if (ssrc[0] < 0) {
      Sipgateway.warn("Couldn't find the video SSRC, simulcasting NOT enabled");
      return sdp;
    }
    if (insertAt < 0) {
      insertAt = lines.length;
    }

    ssrc[1] = Math.floor(Math.random() * 0xffffffff);
    ssrc[2] = Math.floor(Math.random() * 0xffffffff);
    ssrc_fid[1] = Math.floor(Math.random() * 0xffffffff);
    ssrc_fid[2] = Math.floor(Math.random() * 0xffffffff);

    for (var i = 0; i < ssrc.length; i++) {
      if (cname) {
        lines.splice(insertAt, 0, "a=ssrc:" + ssrc[i] + " cname:" + cname);
        insertAt++;
      }
      if (msid) {
        lines.splice(insertAt, 0, "a=ssrc:" + ssrc[i] + " msid:" + msid);
        insertAt++;
      }
      if (mslabel) {
        lines.splice(insertAt, 0, "a=ssrc:" + ssrc[i] + " mslabel:" + mslabel);
        insertAt++;
      }
      if (label) {
        lines.splice(insertAt, 0, "a=ssrc:" + ssrc[i] + " label:" + label);
        insertAt++;
      }

      if (cname) {
        lines.splice(insertAt, 0, "a=ssrc:" + ssrc_fid[i] + " cname:" + cname);
        insertAt++;
      }
      if (msid) {
        lines.splice(insertAt, 0, "a=ssrc:" + ssrc_fid[i] + " msid:" + msid);
        insertAt++;
      }
      if (mslabel) {
        lines.splice(
          insertAt,
          0,
          "a=ssrc:" + ssrc_fid[i] + " mslabel:" + mslabel
        );
        insertAt++;
      }
      if (label) {
        lines.splice(insertAt, 0, "a=ssrc:" + ssrc_fid[i] + " label:" + label);
        insertAt++;
      }
    }
    lines.splice(
      insertAt,
      0,
      "a=ssrc-group:FID " + ssrc[2] + " " + ssrc_fid[2]
    );
    lines.splice(
      insertAt,
      0,
      "a=ssrc-group:FID " + ssrc[1] + " " + ssrc_fid[1]
    );
    lines.splice(
      insertAt,
      0,
      "a=ssrc-group:FID " + ssrc[0] + " " + ssrc_fid[0]
    );
    lines.splice(
      insertAt,
      0,
      "a=ssrc-group:SIM " + ssrc[0] + " " + ssrc[1] + " " + ssrc[2]
    );
    sdp = lines.join("\r\n");
    if (!sdp.endsWith("\r\n")) sdp += "\r\n";
    return sdp;
  }

  function isAudioSendEnabled(media) {
    Sipgateway.debug("isAudioSendEnabled:", media);
    if (!media) return true;
    if (media.audio === false) return false;
    if (media.audioSend === undefined || media.audioSend === null) return true;
    return media.audioSend === true;
  }
  function isAudioSendRequired(media) {
    Sipgateway.debug("isAudioSendRequired:", media);
    if (!media) return false;
    if (media.audio === false || media.audioSend === false) return false;
    if (media.failIfNoAudio === undefined || media.failIfNoAudio === null)
      return false;
    return media.failIfNoAudio === true;
  }
  function isAudioRecvEnabled(media) {
    Sipgateway.debug("isAudioRecvEnabled:", media);
    if (!media) return true;
    if (media.audio === false) return false;
    if (media.audioRecv === undefined || media.audioRecv === null) return true;
    return media.audioRecv === true;
  }
  function isVideoSendEnabled(media) {
    Sipgateway.debug("isVideoSendEnabled:", media);
    if (!media) return true;
    if (media.video === false) return false;
    if (media.videoSend === undefined || media.videoSend === null) return true;
    return media.videoSend === true;
  }
  function isVideoSendRequired(media) {
    Sipgateway.debug("isVideoSendRequired:", media);
    if (!media) return false;
    if (media.video === false || media.videoSend === false) return false;
    if (media.failIfNoVideo === undefined || media.failIfNoVideo === null)
      return false;
    return media.failIfNoVideo === true;
  }
  function isVideoRecvEnabled(media) {
    Sipgateway.debug("isVideoRecvEnabled:", media);
    if (!media) return true;
    if (media.video === false) return false;
    if (media.videoRecv === undefined || media.videoRecv === null) return true;
    return media.videoRecv === true;
  }
  function isScreenSendEnabled(media) {
    Sipgateway.debug("isScreenSendEnabled:", media);
    if (!media) return false;
    if (
      typeof media.video !== "object" ||
      typeof media.video.mandatory !== "object"
    )
      return false;
    var constraints = media.video.mandatory;
    if (constraints.chromeMediaSource)
      return (
        constraints.chromeMediaSource === "desktop" ||
        constraints.chromeMediaSource === "screen"
      );
    else if (constraints.mozMediaSource)
      return (
        constraints.mozMediaSource === "window" ||
        constraints.mozMediaSource === "screen"
      );
    else if (constraints.mediaSource)
      return (
        constraints.mediaSource === "window" ||
        constraints.mediaSource === "screen"
      );
    return false;
  }
  function isDataEnabled(media) {
    Sipgateway.debug("isDataEnabled:", media);
    if (Sipgateway.webRTCAdapter.browserDetails.browser === "edge") {
      Sipgateway.warn("Edge doesn't support data channels yet");
      return false;
    }
    if (media === undefined || media === null) return false;
    return media.data === true;
  }
  function isTrickleEnabled(trickle) {
    Sipgateway.debug("isTrickleEnabled:", trickle);
    return trickle === false ? false : true;
  }
}
export default Sipgateway;

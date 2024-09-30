import Sipgateway from ".";
import type { SipgatewayJS } from ".";

type SIPClientOptions = {
  server: string;
  port: number | string;
  protocol: "ws" | "wss" | (string & {});
  client_id: string;
  debug?: boolean | "all" | SipgatewayJS.DebugLevel[];
  on_event: (
    sip_event: SIPClientEvents,
    data: {
      incomingcall_number: string | undefined;
      incomingcall_name: string | undefined;
    }
  ) => void;
  on_error: (error: Error) => void;
  local_stream: HTMLMediaElement;
  remote_stream: HTMLMediaElement;
};

type SIPClientEvents =
  | "ready"
  | "registered"
  | "registration_failed"
  | "unregistered"
  | "unregistering"
  | "registering"
  | "registered"
  | "registration_failed"
  | "unregistered"
  | "unregistering"
  | "registering"
  | "calling"
  | "incomingcall"
  | "progress"
  | "accepted"
  | "updatingcall"
  | "hangup"
  | "recordingupdated";

export class SIPClient {
  private server: string;
  private port: number | string;
  private protocol: "ws" | "wss" | (string & {});
  private client_id: string;
  private ws_status: "CONNECTED" | "DISCONNECTED" | "CONNECTING" =
    "DISCONNECTED";
  private debug?: boolean | "all" | SipgatewayJS.DebugLevel[];
  private error: undefined | string;
  private JSEP: undefined | SipgatewayJS.JSEP;
  private sip: SipgatewayJS.PluginHandle | undefined;
  private local_stream: HTMLMediaElement | HTMLAudioElement;
  private remote_stream: HTMLMediaElement | HTMLAudioElement;
  private on_error: (error: Error) => void;
  private on_event: (
    sip_event: SIPClientEvents,
    data: {
      incomingcall_number: string | undefined;
      incomingcall_name: string | undefined;
    }
  ) => void;
  private client: undefined | Sipgateway;

  constructor(options: SIPClientOptions) {
    this.server = options.server;
    this.port = options.port;
    this.protocol = options.protocol;
    this.client_id = options.client_id;
    this.debug = options.debug;
    this.local_stream = options.local_stream;
    this.remote_stream = options.remote_stream;
    this.on_event = options.on_event;
    this.on_error = options.on_error;
  }

  public connect() {
    if (this.ws_status !== "DISCONNECTED") {
      return;
    }
    this.ws_status = "CONNECTING";

    Sipgateway.init({
      debug: this.debug,
      callback: () => {
        // Connect to the SIP Gateway
        if (!Sipgateway.isWebrtcSupported()) {
          // Return if WebRTC not supported
          this.ws_status = "DISCONNECTED";
          this.on_error(new Error("WebRTC not supported"));
          return;
        }

        this.client = new Sipgateway({
          server: `${this.protocol}://${this.server}:${this.port}/janus`,
          success: () => {
            this.client?.attach({
              plugin: "janus.plugin.sip",
              opaqueId: this.client_id,

              success: (sipPluginHandle: SipgatewayJS.PluginHandle) => {
                this.ws_status = "CONNECTED";
                this.sip = sipPluginHandle;
                this.on_event("ready", {
                  incomingcall_name: undefined,
                  incomingcall_number: undefined,
                });
              },

              onmessage: (
                msg: SipgatewayJS.Message,
                jsep?: SipgatewayJS.JSEP
              ) => {
                console.log("SIPGATEWAY_MSG: ", msg);
                // Save jsep to make a call
                if (jsep) {
                  this.JSEP = jsep;
                }
                const event = msg.result?.event || "unknown";
                // Events received from the gateway
                if (
                  [
                    "registered",
                    "registration_failed",
                    "unregistered",
                    "unregistering",
                    "registering",
                    "calling",
                    "incomingcall",
                    "progress",
                    "accepted",
                    "updatingcall",
                    "hangup",
                    "recordingupdated",
                  ].includes(event)
                ) {
                  const incomingcall_number = msg.result?.username
                    ? msg.result.username.substring(
                        msg.result.username.lastIndexOf(":") + 1,
                        msg.result.username.lastIndexOf("@")
                      )
                    : undefined;

                  const incomingcall_name =
                    msg.result?.display_name || undefined;

                  this.on_event(event as SIPClientEvents, {
                    incomingcall_number,
                    incomingcall_name,
                  });

                  if (
                    ["progress", "accepted"].includes(event || "") &&
                    this.sip &&
                    this.JSEP
                  ) {
                    this.sip.handleRemoteJsep({
                      jsep: this.JSEP,
                      error: (err: Error) => {
                        this.on_error(err);
                        this.sip?.send({ message: { request: "hangup" } });
                        this.sip?.hangup();
                      },
                    });
                  }

                  if (["updatingcall"].includes(event)) {
                    const hasAudio = this.JSEP
                      ? this.JSEP.sdp.indexOf("m=audio") > -1
                      : false;
                    const hasVideo = this.JSEP
                      ? this.JSEP.sdp.indexOf("m=video") > -1
                      : false;

                    this.sip?.createAnswer({
                      jsep,
                      media: { audio: hasAudio, video: hasVideo },
                      success(jsep2: SipgatewayJS.JSEP) {
                        const body = { request: "update" };
                        this.sip?.send({ message: body, jsep });
                      },
                      error(err: Error) {
                        this.on_error(err);
                      },
                    });
                  }
                }
              },
              onlocalstream: (stream: MediaStream) => {
                Sipgateway.attachMediaStream(this.local_stream, stream);
              },
              onremotestream: (stream: MediaStream) => {
                Sipgateway.attachMediaStream(this.remote_stream, stream);
              },
              oncleanup: () => {
                // Cleaning up after hangup
              },
              detached: () => {
                // Disconnected from the Gateway
                this.ws_status = "DISCONNECTED";
                this.on_event("unregistered", {
                  incomingcall_name: undefined,
                  incomingcall_number: undefined,
                });
              },
              error: (err: Error) => {
                // Error while connecting to the Gateway
                this.on_error(err);
                this.ws_status = "DISCONNECTED";
              },
            });
          },
          error: (err: Error) => {
            // Error while connecting to the WSS
            this.on_error(err);
            this.ws_status = "DISCONNECTED";
          },

          destroyed: () => {
            // On disconnect
            this.ws_status = "DISCONNECTED";
            this.on_event("unregistered", {
              incomingcall_name: undefined,
              incomingcall_number: undefined,
            });
          },
        });
      },
    });
  }

  public mute() {
    if (this.sip && !this.sip.isAudioMuted()) {
      this.sip.muteAudio();
    }
  }

  public unmute() {
    if (this.sip && this.sip.isAudioMuted()) {
      this.sip.unmuteAudio();
    }
  }

  public hold() {
    if (this.sip) {
      this.sip?.send({ message: { request: "hold" } });
    }
  }

  public unhold() {
    if (this.sip) {
      this.sip?.send({ message: { request: "unhold" } });
    }
  }

  public hangup() {
    if (this.sip) {
      this.sip.send({ message: { request: "hangup" } });
      this.sip.hangup();
    }
  }

  public decline() {
    if (this.sip) {
      this.sip.send({ message: { request: "decline" } });
      this.sip.hangup();
    }
  }

  public answer(auth_user: string) {
    if (this.sip) {
      let hasAudio = true;
      let hasVideo = true;
      let offerlessInvite = false;
      if (this.JSEP) {
        hasAudio = this.JSEP.sdp.indexOf("m=audio ") > -1;
        hasVideo = this.JSEP.sdp.indexOf("m=video ") > -1;
      } else {
        offerlessInvite = true;
        hasVideo = false;
      }
      const sipcallAction = offerlessInvite
        ? this.sip.createOffer
        : this.sip.createAnswer;

      sipcallAction({
        jsep: this.JSEP,
        media: { audio: hasAudio, video: hasVideo },
        success: (newJsep: SipgatewayJS.JSEP) => {
          const body = {
            request: "accept",
            headers: {
              Contact: `<sip:${auth_user}@${this.server}>`,
            },
          };
          this.sip?.send({
            message: body,
            jsep: newJsep,
          });
        },
        error: (err: Error) => {
          this.on_error(err);
          const body = { request: "decline", code: 480 };
          this.sip?.send({ message: body });
        },
      });
    }
  }

  public start_call(
    dial_number: string,
    sip_domain: string,
    sip_port: number | string
  ) {
    if (this.sip) {
      this.sip.createOffer({
        media: {
          audioSend: true,
          audioRecv: true,
          videoSend: false,
          videoRecv: false,
        },
        success: (newJsep: SipgatewayJS.JSEP) => {
          const body = {
            request: "call",
            uri: `sip:${dial_number}@${sip_domain}:${sip_port}`,
          };
          console.log(
            "DIALING",
            `sip:${dial_number}@${sip_domain}:${sip_port}`,
            newJsep,
            this.sip
          );
          this.sip?.send({ message: body, jsep: newJsep });
        },
        error: (err: Error) => {
          // Error while dialing
          console.error("ERROR WHILE DIALING", err);
          this.on_error(err);
        },
      });
    }
  }

  public unregister() {
    if (this.sip) {
      this.sip.send({ message: { request: "unregister" } });
    }
  }

  public send_dtmf(dtmf: string) {
    if (this.sip) {
      this.sip.dtmf({ dtmf: { tones: dtmf } });
    }
  }

  public start_recording() {
    if (this.sip) {
      this.sip.send({
        message: {
          request: "recording",
          action: "start",
          audio: true,
          video: false,
          peer_audio: true,
          peer_video: false,
          send_peer_pli: false,
        },
      });
    }
  }

  public stop_recording() {
    if (this.sip) {
      this.sip.send({
        message: {
          request: "recording",
          action: "stop",
          audio: true,
          video: false,
          peer_audio: true,
          peer_video: false,
          send_peer_pli: false,
        },
      });
    }
  }

  public disconnect() {
    if (this.client) {
      this.ws_status = "DISCONNECTED";
      this.client.destroy();
    }
  }
  public register(auth: {
    name?: string;
    user: string;
    password: string;
    domain: string;
    port: number;
    transport: "udp" | "tcp";
  }) {
    if (this.sip) {
      this.sip.send({
        message: {
          authuser: auth.user,
          request: "register",
          username: `sip:${auth.user}@${auth.domain}:${auth.port}`,
          display_name: auth.name || auth.user,
          secret: auth.password,
          force_tcp: auth.transport === "tcp",
          force_udp: auth.transport === "udp",
          proxy: `sip:${auth.domain}:${auth.port}`,
        },
      });
    }
  }
}

import { nanoid } from "nanoid";
import { SIPClient } from "./sip-gateway/sip-client";

export function connect() {
  const localStream = document.querySelector<HTMLAudioElement>("#localStream")!;
  const remoteStream =
    document.querySelector<HTMLAudioElement>("#remoteStream")!;
  const status = document.querySelector<HTMLSpanElement>("#status")!;
  const error = document.querySelector<HTMLSpanElement>("#error")!;

  const webphoneSipClient = new SIPClient({
    client_id: `client-${nanoid(12)}`,
    local_stream: localStream,
    remote_stream: remoteStream,
    on_error: (err) => {
      error.innerText = err.message;
      error.style.display = "block";
    },
    on_event: (sip_event, data) => {
      status.innerText = `${sip_event}${
        data.incomingcall_number ? ` - ${data.incomingcall_number}` : ""
      }`;
    },
    port: 8188,
    server: "webphone.chatmix.com.br",
    protocol: "ws",
    debug: "all",
  });

  // Conecta no Gateway e cria uma nova sessão e conexão WSS
  webphoneSipClient.connect();

  const disconnectButton = document.getElementById("disconnect")!;

  disconnectButton.addEventListener("click", function () {
    webphoneSipClient.disconnect();
  });

  const registerButton = document.getElementById("register")!;

  registerButton.addEventListener("click", function () {
    webphoneSipClient.register({
      domain: "sip.domain.com",
      password: "pass@word",
      user: "100",
      port: 5090,
      transport: "udp",
      name: "100",
    });
  });

  const callButton = document.getElementById("call")!;

  callButton.addEventListener("click", function () {
    const numberToCall = document.getElementById("number")! as HTMLInputElement;

    webphoneSipClient.start_call(numberToCall.value, "sip.domain.com", 5090);
  });

  const answerButton = document.getElementById("answer")!;

  answerButton.addEventListener("click", function () {
    webphoneSipClient.answer("100");
  });

  const hangupButton = document.getElementById("hangup")!;

  hangupButton.addEventListener("click", function () {
    webphoneSipClient.hangup();
  });

  const startRecordButton = document.getElementById("start_record")!;

  startRecordButton.addEventListener("click", function () {
    webphoneSipClient.start_recording();
  });

  const stopRecordButton = document.getElementById("stop_record")!;

  stopRecordButton.addEventListener("click", function () {
    webphoneSipClient.stop_recording();
  });
}

export function setup() {
  const connectButton = document.getElementById("connect")!;

  connectButton.addEventListener("click", function () {
    connect();
  });
}

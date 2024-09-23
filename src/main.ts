import "./style.css";
import viteLogo from "/vite.svg";
import { setup } from "./client.ts";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <a href="https://vitejs.dev" target="_blank">
      <img src="${viteLogo}" class="logo" alt="Vite logo" />
    </a>
    <h1>SIP Webphone</h1>
    <div class="card">
      <button id="connect" type="button">⚡ Conectar</button>
      <button id="register" type="button">☎ Registrar Ramal</button>
      <span id="status" class="status"> disconnected </span>
      <span id="error" class="error" style="display: none"></span>
      <hr />
      <input type="text" id="number" class="number"/>
      <button type="button" id="call">📞 Chamar</button>
      <button type="button" id="answer">Atender</button>
      <button type="button" id="hangup">Desligar</button>
      <hr />
      <button type="button" id="start_record">Gravar</button>
      <button type="button" id="stop_record">Parar Gravacão</button>
      <hr />
      <button id="disconnect" type="button">❌ Desconectar</button>
      
      <audio id="localStream" autoplay playsinline muted></audio>
      <audio id="remoteStream" autoplay playsinline></audio>
    </div>
    <p class="read-the-docs">
      Exemplo de webphone com o SIP Gateway
    </p>
  </div>
`;

setup();

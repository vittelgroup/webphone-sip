# Cliente SIP

Esta é uma implementação em TypeScript de um cliente SIP usando WebRTC que pode ser usado para interagir com um servidor SIP atráves do SIP Gateway. O cliente fornece várias funcionalidades, como conectar-se ao servidor, registrar-se, fazer chamadas, lidar com chamadas recebidas e muito mais.

## Funcionalidades

- Conectar a um servidor SIP usando os protocolos WebSocket (WS) ou WebSocket Secure (WSS)
- Registrar em qualquer servidor SIP
- Chamadas de saída
- Chamadas entrantes
- Colocar chamada em Mudo
- Colocar chamada em espera
- Desligar a chamada
- Recusar uma chamada
- Enviar tons DTMF (Dual-Tone Multi-Frequency)
- Iniciar e parar a gravação de chamada

## Uso

1. Importe a classe `SIPClient` do módulo:

```typescript
import { SIPClient } from "./sipgateway";
```

2. Crie uma nova instância da classe `SIPClient` e configure-a com as informações necessárias:

```typescript
const sipClient = new SIPClient({
  server: "your-sip-server.com",
  port: 8443,
  protocol: "wss",
  client_id: "your-client-id",
  debug: false,
  on_event: (event, data) => {
    // Handle SIP events
    console.log("SIP event:", event, data);
  },
  on_error: (error) => {
    // Handle errors
    console.error("SIP error:", error);
  },
  local_stream: localMediaElement,
  remote_stream: remoteMediaElement,
});
```

3. Conecte ao Gateway

```typescript
sipClient.connect();
```

4. Registre o ramal no servidor SIP (Qualquer PABX)

```typescript
sipClient.register({
  user: "your-sip-username",
  password: "your-sip-password",
  domain: "sip.domain.com",
  port: 5060,
  transport: "udp",
});
```

5. Fazer uma chamada:

```typescript
sipClient.start_call("11992252626", "sip.domain.com", 5060);
```

6. Outras funcionalidades:

```typescript
sipClient.mute(); // Colocar em mudo
sipClient.unmute(); // Tirar do mudo
sipClient.hold(); // Colocar chamada em espera
sipClient.unhold(); // Tirar chamada da espera
sipClient.hangup(); // Desligar a chamada
sipClient.decline(); // Recusar a chamada
sipClient.send_dtmf("123"); // Enviar tons DTMF (para transfêrencias)
sipClient.start_recording(); // Iniciar gravação da chamada
sipClient.stop_recording(); // Parar gravação da chamada
sipClient.disconnect(); // Desconectar ramal e do gateway
```

## Eventos

A classe `SIPClient` emite vários eventos que podem ser manipulados usando o callback `on_event`. Os seguintes eventos são suportados:

- `ready`: O cliente está pronto para uso (Conectado com sucesso no gateway)
- `registered`: O cliente foi registrado com sucesso no servidor SIP.
- `registration_failed`: O registro do ramal falhou (usuario ou senha errada).
- `unregistered`: O ramal do cliente foi desconectado do servidor SIP.
- `unregistering`: O ramal do cliente está sendo desconectado do servidor SIP.
- `registering`: O ramal do cliente está registrando no servidor SIP.
- `calling`: O cliente está fazendo uma chamada sainte.
- `incomingcall`: O cliente está recebendo uma chamada.
- `progress`: A chamada está em progresso.
- `accepted`: A chamada foi aceita.
- `updatingcall`: A chamada está sendo atualizada.
- `hangup`: A chamada foi desligada.
- `recordingupdated`: O status da gravação da chamada foi atualizada.

## Erros

A classe `SIPClient` também fornece um callback `on_error` para manipular quaisquer erros que ocorram durante a operação do cliente. Os erros podem estar relacionados a WebRTC, comunicação do servidor SIP ou outros problemas.

## Dependências

A classe `SIPClient` depende da biblioteca `Sipgateway`, que é uma biblioteca personalizada que conecta com gateway SIP. Certifique-se de importar e inicializar a biblioteca `Sipgateway` antes de usar a classe `SIPClient`. A biblioteca `Sipgateway` importa outra dependencia `webrtc-adapter`, certifique-se de que a mesma esteja instalada.

A classe `SIPClient` é um exemplo de uso do Gateway, fique a vontade para edita-la.

---

# Gateway SIP

O Gateway é responsável em fazer a conexão do cliente (WebRTC no browser) com o servidor SIP (qualquer PABX). Deste modo, o cliente conecta no Gateway via WSS e o Gateway conecta no PABX via SIP. O gateway também pode gravar as chamadas, armazenar e enviar a outro lugar.

Assim como cliente o Gateway pode enviar eventos de todos os clientes conectados a ele.

## Eventos

Os eventos possuem o seguinte corpo:

```json
{
  // ID da sessão (gerado automaticamente pelo gateway)
  "session_id": 7924161977477011,
  // ID do cliente (pode ser fornecido na criação do cliente)
  "client_id": "unique-id-identifing-user",
  // Tipo do evento
  "event": "calling",
  // Detalhes da chamada (se tiver em chamada, caso contrário os campos ficarão como 'undefined')
  "call_details": {
    // Quem está sendo chamado
    "callee": "4000",
    // Chamador (nesse caso o cliente)
    "caller": "unique-id-identifing-user",
    // ID da chamada
    "call_id": "6QfTseOZQwZbOhKXAVQQnDa",
    // Nome de quem está sendo chamado (caso o ramal possua um CallerID)
    "callee_name": "4000",
    // Nome do chamadorm (nesse caso o ID do cliente)
    "caller_name": "unique-id-identifing-user"
  }
}
```

- `connected` Cliente conectou ao Gateway via WS.
- `disconnected` Cliente desconectou-se do Gateway.
- `calling` Cliente iniciou uma nova chamada.
- `proceeding` Cliente iniciou a chamada e o PABX está ligando para o destino.
- `incomingcall` Cliente está recebendo uma chamada.
- `registered` Cliente registrou o ramal com sucesso.
- `unregistered` Cliente desconectou o ramal.
- `hangup` Chamada foi desligada.
- `answered` Chamada foi atendida.

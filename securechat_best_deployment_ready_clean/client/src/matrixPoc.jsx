import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { startMatrixE2EE, stopMatrixE2EE } from './matrixE2EE';
import './matrixPoc.css';

const HOMESERVER = 'https://matrix-client.matrix.org';

function MatrixPoc() {
  const [form, setForm] = useState({ user: '', password: '', peer: '' });
  const [status, setStatus] = useState('Not connected');
  const [client, setClient] = useState(null);
  const [roomId, setRoomId] = useState('');
  const [text, setText] = useState('');
  const [messages, setMessages] = useState([]);
  const [busy, setBusy] = useState(false);
  const seen = useRef(new Set());

  useEffect(() => () => stopMatrixE2EE(), []);

  function field(name, value) {
    setForm(current => ({ ...current, [name]: value }));
  }

  async function login(event) {
    event.preventDefault();
    setBusy(true);
    setStatus('Signing in to Matrix…');

    try {
      const sdk = await import('matrix-js-sdk');
      const temporaryClient = sdk.createClient({ baseUrl: HOMESERVER });
      const session = await temporaryClient.loginRequest({
        type: 'm.login.password',
        identifier: { type: 'm.id.user', user: form.user.trim() },
        password: form.password,
        initial_device_display_name: 'SecureChat E2EE proof of concept'
      });

      setForm(current => ({ ...current, password: '' }));
      const encryptedClient = await startMatrixE2EE({
        accessToken: session.access_token,
        userId: session.user_id,
        deviceId: session.device_id,
        homeserverUrl: HOMESERVER
      });

      encryptedClient.on('Room.timeline', (matrixEvent, room, toStartOfTimeline) => {
        if (toStartOfTimeline || matrixEvent.getType() !== 'm.room.message') return;
        const id = matrixEvent.getId();
        if (!id || seen.current.has(id)) return;
        seen.current.add(id);
        setMessages(current => [...current, {
          id,
          sender: matrixEvent.getSender(),
          body: matrixEvent.getContent()?.body || '',
          roomId: room?.roomId || ''
        }]);
      });

      setClient(encryptedClient);
      setStatus(`E2EE ready as ${session.user_id}`);
    } catch (error) {
      setStatus(error.message || 'Matrix login failed.');
    } finally {
      setForm(current => ({ ...current, password: '' }));
      setBusy(false);
    }
  }

  async function createEncryptedRoom() {
    if (!client || !form.peer.trim()) return;
    setBusy(true);
    setStatus('Creating encrypted room…');

    try {
      const result = await client.createRoom({
        preset: 'private_chat',
        is_direct: true,
        invite: [form.peer.trim()],
        initial_state: [{
          type: 'm.room.encryption',
          state_key: '',
          content: { algorithm: 'm.megolm.v1.aes-sha2' }
        }]
      });
      setRoomId(result.room_id);
      setStatus(`Encrypted room ready: ${result.room_id}`);
    } catch (error) {
      setStatus(error.message || 'Could not create encrypted room.');
    } finally {
      setBusy(false);
    }
  }

  async function send(event) {
    event.preventDefault();
    if (!client || !roomId || !text.trim()) return;
    setBusy(true);

    try {
      await client.sendEvent(roomId, 'm.room.message', {
        msgtype: 'm.text',
        body: text.trim()
      });
      setText('');
      setStatus('Encrypted message sent.');
    } catch (error) {
      setStatus(error.message || 'Encrypted message failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="poc">
      <section className="pocCard">
        <p className="eyebrow">Isolated development tool</p>
        <h1>Matrix E2EE Test</h1>
        <p>This page does not use SecureChat accounts or its production message database.</p>

        {!client ? (
          <form onSubmit={login}>
            <label>Matrix ID</label>
            <input
              value={form.user}
              onChange={event => field('user', event.target.value)}
              placeholder="@username:matrix.org"
              autoComplete="username"
              required
            />
            <label>Matrix password</label>
            <input
              value={form.password}
              onChange={event => field('password', event.target.value)}
              type="password"
              autoComplete="current-password"
              required
            />
            <button disabled={busy}>{busy ? 'Connecting…' : 'Start encrypted session'}</button>
          </form>
        ) : (
          <>
            <div className="roomSetup">
              <input
                value={form.peer}
                onChange={event => field('peer', event.target.value)}
                placeholder="Invite @friend:matrix.org"
              />
              <button disabled={busy} onClick={createEncryptedRoom}>Create encrypted room</button>
            </div>

            <div className="timeline">
              {messages.filter(message => !roomId || message.roomId === roomId).map(message => (
                <article key={message.id}>
                  <small>{message.sender}</small>
                  <div>{message.body}</div>
                </article>
              ))}
            </div>

            <form className="sendRow" onSubmit={send}>
              <input value={text} onChange={event => setText(event.target.value)} placeholder="Encrypted message" />
              <button disabled={busy || !roomId}>Send</button>
            </form>
          </>
        )}

        <div className="status" role="status">{status}</div>
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')).render(<MatrixPoc />);

import { SERVER_TS, type Db, type Unsub } from './db';

/** Classic RTDB presence: /status/{uid} = online while connected, offline + lastSeen after. */
export function startPresence(db: Db, uid: string): Unsub {
  const path = `status/${uid}`;
  return db.onConnected((connected) => {
    if (!connected) return;
    void db
      .onDisconnect(path)
      .set({ state: 'offline', lastSeen: SERVER_TS })
      .then(() => db.set(path, { state: 'online', lastSeen: SERVER_TS }));
  });
}

import { describe, expect, it } from 'vitest';
import { cleanText, hasProfanity, validateName } from '../../src/net/filter';
import { MemoryStore } from '../../src/net/local/localDb';
import { startPresence } from '../../src/net/presence';
import { ProfileError, ProfileService } from '../../src/net/profile';
import { client, flush } from './helpers';

describe('ProfileService', () => {
  it('creates profile + stats rows on first sign-in, reuses them later', async () => {
    const store = new MemoryStore();
    const be = client(store, 'u1');
    const ps = new ProfileService(be);
    const p = await ps.init();
    expect(p.name).toMatch(/^Khách#\d{4}$/);
    expect(ps.stats!.rating).toBe(1000);
    expect(typeof p.createdAt).toBe('number');

    const again = new ProfileService(client(store, 'u1'));
    await again.init();
    expect(again.profile!.name).toBe(p.name);
  });

  it('updates name/avatar/country and mirrors them into stats', async () => {
    const be = client(new MemoryStore(), 'u2');
    const ps = new ProfileService(be);
    await ps.init();
    await ps.update({ name: '  Neon Fox ', avatar: 3, country: 'JP' });
    expect(await be.db.get('users/u2/name')).toBe('Neon Fox');
    expect(await be.db.get('stats/u2/name')).toBe('Neon Fox');
    expect(await be.db.get('stats/u2/country')).toBe('JP');
    await expect(ps.update({ name: 'ab' })).rejects.toBeInstanceOf(ProfileError);
    await expect(ps.update({ name: 'fuck you' })).rejects.toThrow('name.bad');
  });

  it('linking Google (local fake) marks the profile as linked, same uid', async () => {
    const be = client(new MemoryStore(), 'u3');
    const ps = new ProfileService(be);
    await ps.init();
    const res = await ps.linkGoogle(async () => true);
    expect(res.status).toBe('linked');
    expect(ps.uid).toBe('u3');
    expect(await be.db.get('users/u3/linked')).toBe(true);
  });

  it('presence goes online, and offline after disconnect', async () => {
    const store = new MemoryStore();
    const be = client(store, 'u4');
    startPresence(be.db, 'u4');
    await flush();
    await flush();
    expect(await be.db.get('status/u4/state')).toBe('online');
    be.db.simulateDisconnect();
    expect(await be.db.get('status/u4/state')).toBe('offline');
  });
});

describe('text filter', () => {
  it('catches obvious profanity, ignores diacritics tricks and normal words', () => {
    expect(hasProfanity('đ.ị.t')).toBe(false); // dots between letters are separators of tokens, not one word
    expect(hasProfanity('DIT me may')).toBe(true);
    expect(hasProfanity('vcl')).toBe(true);
    expect(hasProfanity('các bạn chơi lớn quá, buổi tối vui')).toBe(false);
    expect(hasProfanity('nice game')).toBe(false);
    expect(cleanText('what the fuck man')).toBe('what the **** man');
  });

  it('validates display names', () => {
    expect(validateName('ab')).toBe('short');
    expect(validateName('x'.repeat(17))).toBe('long');
    expect(validateName('<script>')).toBe('chars');
    expect(validateName('Cáo Neon')).toBeNull();
  });
});

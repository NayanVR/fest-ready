// Server-only user store. ponytail: users live in this process's memory and are lost on dashboard restart (admin is always re-seeded); persist if accounts must survive.
declare const Bun: { password: { hash(p: string): Promise<string>; verify(p: string, h: string): Promise<boolean> } };

// On globalThis so every route bundle shares one Map.
const g = globalThis as { __frUsers?: Map<string, Promise<string>> };
const users = (g.__frUsers ??= new Map([["admin", Bun.password.hash("admin")]]));

export async function checkLogin(name: string, password: string): Promise<boolean> {
  const hash = users.get(name);
  return !!hash && Bun.password.verify(password, await hash);
}

/** null on success, else the message to show. */
export async function signup(name: string, password: string): Promise<string | null> {
  if (!/^[a-z0-9._-]{3,32}$/.test(name)) return "Username must be 3–32 characters: a–z, 0–9, dot, dash or underscore.";
  if (password.length < 4) return "Password must be at least 4 characters.";
  if (users.has(name)) return "That username is taken.";
  users.set(name, Bun.password.hash(password));
  return null;
}

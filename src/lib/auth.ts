import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import bcrypt from "bcryptjs";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "gbx-family-office-secret-change-me-in-production"
);

const USERS = [
  {
    id: "person1",
    name: process.env.USER1_NAME || "Caillin",
    passwordHash: process.env.USER1_PASSWORD_HASH || bcrypt.hashSync("changeme1", 10),
  },
  {
    id: "person2",
    name: process.env.USER2_NAME || "Partner",
    passwordHash: process.env.USER2_PASSWORD_HASH || bcrypt.hashSync("changeme2", 10),
  },
];

export async function authenticate(name: string, password: string) {
  const user = USERS.find(
    (u) => u.name.toLowerCase() === name.toLowerCase()
  );
  if (!user) return null;

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) return null;

  const token = await new SignJWT({ userId: user.id, name: user.name })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("7d")
    .sign(JWT_SECRET);

  return { token, user: { id: user.id, name: user.name } };
}

export async function verifyToken(token: string) {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return payload as { userId: string; name: string };
  } catch {
    return null;
  }
}

export async function getCurrentUser() {
  const cookieStore = await cookies();
  const token = cookieStore.get("auth-token")?.value;
  if (!token) return null;
  return verifyToken(token);
}

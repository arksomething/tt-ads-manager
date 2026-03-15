export async function requireUser() {
  const { auth } = await import("@/auth");
  const session = await auth();

  if (!session?.user?.id) {
    throw new Error("Unauthorized");
  }

  return session.user;
}

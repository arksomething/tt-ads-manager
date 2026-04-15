import { NoteEntityType } from "@/lib/prisma-shim";
import { z } from "zod";

export const createNoteSchema = z.object({
  organizationId: z.string().cuid(),
  entityType: z.nativeEnum(NoteEntityType),
  entityId: z.string().cuid(),
  body: z.string().min(1).max(10000),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;

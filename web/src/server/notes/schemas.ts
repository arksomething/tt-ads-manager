import { NoteEntityType } from "@/lib/prisma-shim";
import { z } from "zod";

export const createNoteSchema = z.object({
  organizationId: z.string().min(1).max(191),
  entityType: z.nativeEnum(NoteEntityType),
  entityId: z.string().min(1).max(191),
  body: z.string().min(1).max(10000),
});

export type CreateNoteInput = z.infer<typeof createNoteSchema>;

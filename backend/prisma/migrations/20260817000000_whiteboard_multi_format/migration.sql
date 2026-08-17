-- Capture now accepts more than one attachment per meeting, and more than
-- photographs of a physical whiteboard: slides, PDFs and Word documents can
-- carry the same kind of context. `kind` records which, so the UI can label
-- each upload and a Word document (no diagram to draw) can leave `mermaid`
-- empty without lying about having one.

CREATE TYPE "WhiteboardKind" AS ENUM ('WHITEBOARD', 'SLIDE', 'DOCUMENT');

ALTER TABLE "Whiteboard" ADD COLUMN "kind" "WhiteboardKind" NOT NULL DEFAULT 'WHITEBOARD';

-- Every whiteboard captured before this migration is, definitionally, a
-- photograph of a whiteboard — the default above is exact for existing rows,
-- not a placeholder standing in for unknown data.

ALTER TABLE "Whiteboard" ALTER COLUMN "mermaid" DROP NOT NULL;

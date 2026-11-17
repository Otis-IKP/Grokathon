import { extractText, getDocumentProxy } from "unpdf";
import { AppError } from "@/lib/errors";
import { rateLimit } from "@/lib/rateLimit";
import { appRoute } from "@/server/api/route";
import { submitLinkedinPdfText } from "@/server/linkedin/service";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * multipart, one PDF, max 5 MB. The bytes are parsed in memory and discarded;
 * only the extracted text goes into the job, and it is scrubbed when the job
 * finishes (privacy rule 9). Nothing here is logged.
 */
export const POST = appRoute(async ({ req, db, me }) => {
  rateLimit(`linkedin:${me.user.id}`, 6, 10 * 60_000);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError("invalid_request", "Send the PDF as multipart form data in a field named file.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError("invalid_request", "No file was uploaded.");
  if (file.size > MAX_BYTES) throw new AppError("pdf_too_large", "That PDF is larger than 5 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isPdf = bytes.length > 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46;
  if (!isPdf) throw new AppError("invalid_pdf", "That file is not a PDF.");
  let text: string;
  try {
    const pdf = await getDocumentProxy(bytes);
    const out = await extractText(pdf, { mergePages: true });
    text = Array.isArray(out.text) ? out.text.join("\n") : out.text;
  } catch {
    throw new AppError("invalid_pdf", "We couldn't read that PDF. Use LinkedIn's More → Save to PDF.");
  }
  return submitLinkedinPdfText(db, me.user, text);
});

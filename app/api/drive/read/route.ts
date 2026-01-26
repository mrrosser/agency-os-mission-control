import { NextResponse } from "next/server";
import { z } from "zod";
import { google } from "googleapis";
import { withApiHandler } from "@/lib/api/handler";
import { parseJson } from "@/lib/api/validation";
import { requireFirebaseAuth } from "@/lib/api/auth";
import { getAccessTokenForUser } from "@/lib/google/oauth";

const bodySchema = z.object({
  fileId: z.string().min(1),
});

export const POST = withApiHandler(
  async ({ request, log }) => {
    const body = await parseJson(request, bodySchema);
    const user = await requireFirebaseAuth(request, log);
    const accessToken = await getAccessTokenForUser(user.uid, log);

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: accessToken });
    const drive = google.drive({ version: "v3", auth });

    log.info("drive.read.metadata", { fileId: body.fileId });
    const fileMetadata = await drive.files.get({
      fileId: body.fileId,
      fields: "name, mimeType",
    });

    const mimeType = fileMetadata.data.mimeType;
    let content = "";

    if (mimeType === "application/vnd.google-apps.document") {
      const response = await drive.files.export({
        fileId: body.fileId,
        mimeType: "text/plain",
      });
      content = response.data as string;
    } else if (mimeType === "text/plain" || mimeType === "text/markdown") {
      const response = await drive.files.get({
        fileId: body.fileId,
        alt: "media",
      });
      content = response.data as string;
    } else if (mimeType === "application/pdf") {
      content = "[PDF Content: Text extraction pending server-side setup]";
    } else {
      content = `[Unsupported file type: ${mimeType}]`;
    }

    content = content.slice(0, 5000);

    return NextResponse.json({
      success: true,
      content,
      name: fileMetadata.data.name,
    });
  },
  { route: "drive.read" }
);

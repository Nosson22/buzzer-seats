import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  const allowedTypes = ["image/jpeg", "image/png", "image/webp", "image/gif"];
  if (!allowedTypes.includes(file.type)) {
    return NextResponse.json({ error: "Invalid file type" }, { status: 400 });
  }

  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
  }

  // Upload to Cloudinary
  const cloudFormData = new FormData();
  cloudFormData.append("file", file);
  cloudFormData.append("upload_preset", "marlins_tickets");
  cloudFormData.append("folder", "ticket-verification");

  const cloudRes = await fetch(
    `https://api.cloudinary.com/v1_1/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(
          `${process.env.CLOUDINARY_API_KEY}:${process.env.CLOUDINARY_API_SECRET}`
        ).toString("base64")}`,
      },
      body: cloudFormData,
    }
  );

  if (!cloudRes.ok) {
    console.error("Cloudinary error:", await cloudRes.text());
    return NextResponse.json({ error: "Upload failed" }, { status: 500 });
  }

  const { secure_url } = await cloudRes.json();
  return NextResponse.json({ url: secure_url });
}

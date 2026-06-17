// Cloudinary upload helper for ticket verification images

export async function uploadToCloudinary(
  file: File
): Promise<{ url: string; publicId: string }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append(
    "upload_preset",
    process.env.NEXT_PUBLIC_CLOUDINARY_UPLOAD_PRESET || "marlins_tickets"
  );

  const res = await fetch(
    `https://api.cloudinary.com/v1_1/${process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME}/image/upload`,
    { method: "POST", body: formData }
  );

  if (!res.ok) throw new Error("Upload failed");
  const data = await res.json();
  return { url: data.secure_url, publicId: data.public_id };
}

// Server-side: upload via API route which proxies to Cloudinary
export async function uploadImage(file: File): Promise<string> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/upload", { method: "POST", body: fd });
  if (!res.ok) throw new Error("Image upload failed");
  const { url } = await res.json();
  return url;
}

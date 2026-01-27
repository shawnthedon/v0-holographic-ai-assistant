import { NextRequest, NextResponse } from 'next/server';

/**
 * File upload handler for Knowledge Base (RAG)
 * Supports PDF, TXT, DOC, DOCX files
 * Integrates with RAG pipeline for semantic search
 */

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json(
        { error: 'No files provided' },
        { status: 400 }
      );
    }

    // Validate file types
    const validTypes = ['application/pdf', 'text/plain', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const uploadedFiles = [];

    for (const file of files) {
      if (!validTypes.includes(file.type)) {
        console.warn(`Skipping invalid file type: ${file.type}`);
        continue;
      }

      if (file.size > 10 * 1024 * 1024) {
        console.warn(`File too large: ${file.name}`);
        continue;
      }

      // In a real implementation, you would:
      // 1. Store the file (e.g., to object storage like Vercel Blob)
      // 2. Parse the content (PDF extraction, text parsing)
      // 3. Create embeddings using your LLM provider
      // 4. Store embeddings in a vector database (Supabase, Pinecone, etc.)
      // 5. Return metadata for retrieval

      const fileBuffer = await file.arrayBuffer();
      console.log(`[v0] Processing file: ${file.name} (${fileBuffer.byteLength} bytes)`);

      uploadedFiles.push({
        name: file.name,
        size: file.size,
        type: file.type,
        uploadedAt: new Date().toISOString(),
        status: 'processing',
      });
    }

    if (uploadedFiles.length === 0) {
      return NextResponse.json(
        { error: 'No valid files to process' },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      uploadedFiles,
      message: `${uploadedFiles.length} file(s) uploaded and are being processed for RAG pipeline`,
    });
  } catch (error) {
    console.error('[v0] Upload error:', error);
    return NextResponse.json(
      { error: 'File upload failed' },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({
    message: 'Knowledge Base Upload API',
    supportedFormats: ['PDF', 'TXT', 'DOC', 'DOCX'],
    maxFileSize: '10MB',
  });
}

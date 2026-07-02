import { NextRequest, NextResponse } from 'next/server';

interface FaceCaptureRequest {
  frames: Array<{
    keyLandmarks: Array<{ idx: number; x: number; y: number; z: number }>;
    blendshapes: Record<string, number>;
    confidence: number;
  }>;
  timestamp: string;
}

/**
 * POST /api/face-capture
 * Receive face mesh frames and forward to processing backend
 */
export async function POST(request: NextRequest) {
  try {
    const body: FaceCaptureRequest = await request.json();

    // Validate request
    if (!body.frames || !Array.isArray(body.frames) || body.frames.length === 0) {
      return NextResponse.json(
        { error: 'No frames provided' },
        { status: 400 }
      );
    }

    console.log('[v0] Face capture received:', {
      frameCount: body.frames.length,
      timestamp: body.timestamp,
      avgConfidence:
        body.frames.reduce((sum, f) => sum + f.confidence, 0) /
        body.frames.length,
    });

    // TODO: Forward to DECA or other 3D face reconstruction service
    // This is a placeholder that returns mock data
    const processedData = {
      meshId: `mesh_${Date.now()}`,
      frameCount: body.frames.length,
      avgConfidence:
        body.frames.reduce((sum, f) => sum + f.confidence, 0) /
        body.frames.length,
      blendshapesSummary: aggregateBlendshapes(body.frames),
      status: 'processed',
      timestamp: new Date().toISOString(),
    };

    return NextResponse.json(processedData, { status: 200 });
  } catch (error) {
    console.error('[v0] Face capture error:', error);
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Processing failed',
      },
      { status: 500 }
    );
  }
}

/**
 * Aggregate blendshapes across frames
 */
function aggregateBlendshapes(
  frames: Array<{ blendshapes: Record<string, number> }>
): Record<string, number> {
  const aggregated: Record<string, number> = {};

  for (const frame of frames) {
    for (const [key, value] of Object.entries(frame.blendshapes)) {
      aggregated[key] = (aggregated[key] || 0) + value;
    }
  }

  // Average across frames
  for (const key in aggregated) {
    aggregated[key] /= frames.length;
  }

  return aggregated;
}

/**
 * OPTIONS handler for CORS preflight
 */
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
}

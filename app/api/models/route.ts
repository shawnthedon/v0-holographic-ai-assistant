import { NextRequest, NextResponse } from 'next/server';
import {
  catalogue,
  discoverAll,
  discoverProvider,
  isVerified,
  preferredModelId,
  providers,
} from '@/lib/llm/service';
import { DEFAULT_MODEL_ID } from '@/lib/llm/catalogue';
import { LLMError, type ModelRole, type ProviderId } from '@/lib/llm/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /api/models
 *   ?roles=chat,speech-out   filter by capability
 *   ?discover=openrouter     also ask the provider what it currently serves
 *   ?discover=all            ask every provider what it serves, in parallel
 *   ?refresh=1               bypass the 5-minute discovery cache
 *   ?provider=openai         restrict to one provider
 *
 * Returns the catalogue plus which providers this deployment can actually use,
 * so the picker can grey out models instead of failing at send time.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const roleFilter = params.get('roles')?.split(',').filter(Boolean) as ModelRole[] | undefined;
  const providerFilter = params.get('provider') as ProviderId | null;
  const discoverParam = params.get('discover');

  try {
    let models = catalogue();

    if (roleFilter?.length) {
      models = models.filter((entry) => entry.roles.some((role) => roleFilter.includes(role)));
    }
    if (providerFilter) {
      models = models.filter((entry) => entry.provider === providerFilter);
    }

    const providerList = providers();
    const configured = new Set(
      providerList.filter((entry) => entry.configured).map((entry) => entry.provider),
    );

    const decorated = models.map((entry) => ({
      ...entry,
      configured: configured.has(entry.provider),
      // Only models that answered a live request are badged — never a model
      // that merely has a credential sitting next to it.
      verified: isVerified(entry.id),
    }));

    let discovered: Awaited<ReturnType<typeof discoverProvider>> | undefined;
    let discoverError: { code: string; message: string; fix: string } | undefined;
    let discoverFailures: unknown[] | undefined;
    let discovery: { fetchedAt: string; cached: boolean; counts: Record<string, number> } | undefined;
    const refresh = params.get('refresh') === '1';

    if (discoverParam === 'all') {
      // One fan-out, cached 5 minutes. A provider that fails is reported
      // individually — it must not hide the providers that answered.
      const result = await discoverAll({
        providerIds: providerFilter ? [providerFilter] : undefined,
        refresh,
      });
      discovered = result.models;
      discoverFailures = result.failures;
      discovery = { fetchedAt: result.fetchedAt, cached: result.cached, counts: result.counts };
    } else if (discoverParam) {
      try {
        discovered = await discoverProvider(discoverParam as ProviderId);
      } catch (error) {
        if (error instanceof LLMError) {
          discoverError = { code: error.code, message: error.message, fix: error.fix };
        } else {
          discoverError = {
            code: 'provider-error',
            message: error instanceof Error ? error.message : 'discovery failed',
            fix: 'Check the provider credential and base URL.',
          };
        }
      }
    }

    return NextResponse.json(
      {
        // DEFAULT_MODEL_ID is the catalogue anchor; defaultModelId is what this
        // deployment can actually run right now (and what /api/chat uses when
        // the caller names no model).
        defaultModelId: preferredModelId(),
        catalogueDefaultModelId: DEFAULT_MODEL_ID,
        models: decorated,
        providers: providerList,
        discovered: discovered?.map((entry) => ({
          ...entry,
          configured: configured.has(entry.provider),
          verified: isVerified(entry.id),
        })),
        discoverError,
        discoverFailures,
        discovery,
      },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to list models',
        fix: 'Check lib/llm/catalogue.ts for invalid entries.',
        models: [],
        providers: [],
      },
      { status: 500 },
    );
  }
}

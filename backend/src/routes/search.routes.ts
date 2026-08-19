import type { PrismaClient } from '@prisma/client';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/middleware.js';

export interface SearchItem {
  readonly id: string;
  readonly category: 'meeting' | 'decision' | 'action_item' | 'shariah' | 'knowledge' | 'feature';
  readonly title: string;
  readonly subtitle?: string;
  readonly badge?: string;
  readonly href: string;
}

const STATIC_FEATURES: readonly {
  readonly name: string;
  readonly keywords: readonly string[];
  readonly description: string;
  readonly href: string;
}[] = [
  {
    name: 'Capture Meeting',
    keywords: ['capture', 'record', 'audio', 'upload', 'google meet', 'mic', 'whiteboard', 'transcribe'],
    description: 'Record or upload a meeting discussion or auto-import from Google Meet',
    href: '/record',
  },
  {
    name: 'Review Meetings',
    keywords: ['review', 'meetings', 'transcripts', 'redactions', 'shariah findings', 'history', 'list'],
    description: 'Review transcripts, PII redactions and Shariah governance findings',
    href: '/meetings',
  },
  {
    name: 'Decide & Approvals',
    keywords: ['decide', 'approvals', 'term sheet', 'maker', 'checker', 'settlement', 'disburse', 'loan'],
    description: 'Review drafted term sheets, approval workflows and disbursement settlement',
    href: '/approvals',
  },
  {
    name: 'Knowledge Graph',
    keywords: ['knowledge', 'graph', 'nodes', 'network', 'topics', 'ask ai', 'chat', 'assistant', 'similarity'],
    description: 'Ask across every meeting and explore connected topics & cluster nodes',
    href: '/knowledge',
  },
  {
    name: 'Islamic Banking Guidelines',
    keywords: ['islamic banking', 'shariah', 'rules', 'murabahah', 'tawarruq', 'ijarah', 'musharakah', 'mudarabah', 'riba', 'gharar'],
    description: 'Browse Shariah screening rules, contract structures and compliance standards',
    href: '/islamic-banking',
  },
  {
    name: 'Administration & Users',
    keywords: ['admin', 'administration', 'users', 'staff', 'accounts', 'permissions', 'roles'],
    description: 'Manage users, role capabilities and account approvals',
    href: '/admin',
  },
  {
    name: 'Audit Trail',
    keywords: ['audit', 'chain', 'logs', 'hash', 'security', 'compliance log', 'tamper-evident'],
    description: 'View the tamper-evident cryptographic audit hash chain',
    href: '/audit',
  },
  {
    name: 'Account & Integration Settings',
    keywords: ['settings', 'google', 'oauth', 'workspace', 'profile', 'theme', 'password'],
    description: 'Manage Google Workspace connection, security settings and preferences',
    href: '/settings',
  },
];

const QuerySchema = z.object({
  q: z.string().min(1).max(100),
});

export function registerSearchRoutes(app: FastifyInstance, prisma: PrismaClient): void {
  const gate = { preHandler: [requireAuth] };

  app.get('/search', gate, async (request, reply) => {
    const parsed = QuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.send({ results: [] });
    }

    const query = parsed.data.q.trim();
    const queryLower = query.toLowerCase();

    // 1. Search Features
    const featureResults: SearchItem[] = STATIC_FEATURES.filter((f) => {
      return (
        f.name.toLowerCase().includes(queryLower) ||
        f.description.toLowerCase().includes(queryLower) ||
        f.keywords.some((k) => k.includes(queryLower) || queryLower.includes(k))
      );
    }).slice(0, 3).map((f) => ({
      id: `feat-${f.href}`,
      category: 'feature',
      title: f.name,
      subtitle: f.description,
      badge: 'Feature',
      href: f.href,
    }));

    // 2. Search Database in Parallel
    const [meetings, decisions, actionItems, shariahFlags, topics] = await Promise.all([
      // Meetings
      prisma.meeting.findMany({
        where: {
          OR: [
            { title: { contains: query, mode: 'insensitive' } },
            { description: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: { id: true, title: true, occurredAt: true, status: true },
        orderBy: { occurredAt: 'desc' },
        take: 5,
      }),

      // Decisions
      prisma.meetingDecision.findMany({
        where: {
          OR: [
            { topic: { contains: query, mode: 'insensitive' } },
            { decision: { contains: query, mode: 'insensitive' } },
            { rationale: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          topic: true,
          decision: true,
          meeting: { select: { id: true, title: true } },
        },
        take: 5,
      }),

      // Action Items
      prisma.actionItem.findMany({
        where: {
          OR: [
            { task: { contains: query, mode: 'insensitive' } },
            { owner: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          task: true,
          owner: true,
          dueDate: true,
          meeting: { select: { id: true, title: true } },
        },
        take: 5,
      }),

      // Shariah Findings
      prisma.shariahFlag.findMany({
        where: {
          OR: [
            { excerpt: { contains: query, mode: 'insensitive' } },
            { reference: { contains: query, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          issueType: true,
          excerpt: true,
          status: true,
          meeting: { select: { id: true, title: true } },
        },
        take: 5,
      }),

      // Knowledge Topics & Nodes
      prisma.meetingTopic.findMany({
        where: {
          topic: { contains: query, mode: 'insensitive' },
        },
        select: {
          id: true,
          topic: true,
          relevance: true,
          meeting: { select: { id: true, title: true } },
        },
        take: 5,
      }),
    ]);

    const meetingResults: SearchItem[] = meetings.map((m) => ({
      id: m.id,
      category: 'meeting',
      title: m.title,
      subtitle: new Date(m.occurredAt).toLocaleDateString(),
      badge: m.status,
      href: `/meetings/${m.id}`,
    }));

    const decisionResults: SearchItem[] = decisions.map((d) => ({
      id: d.id,
      category: 'decision',
      title: d.decision || d.topic,
      subtitle: `Meeting: ${d.meeting.title} · Topic: ${d.topic}`,
      badge: 'Decision',
      href: `/meetings/${d.meeting.id}?tab=summary`,
    }));

    const actionResults: SearchItem[] = actionItems.map((a) => ({
      id: a.id,
      category: 'action_item',
      title: a.task,
      subtitle: `Assigned to: ${a.owner}${a.dueDate ? ` · Due: ${a.dueDate}` : ''} (${a.meeting.title})`,
      badge: 'Action Item',
      href: `/meetings/${a.meeting.id}?tab=summary`,
    }));

    const shariahResults: SearchItem[] = shariahFlags.map((s) => ({
      id: s.id,
      category: 'shariah',
      title: `${s.issueType.replace('_', ' ')} finding`,
      subtitle: `"${s.excerpt.slice(0, 80)}..." in ${s.meeting.title}`,
      badge: s.status,
      href: `/meetings/${s.meeting.id}?tab=summary`,
    }));

    const knowledgeResults: SearchItem[] = topics.map((t) => ({
      id: t.id,
      category: 'knowledge',
      title: t.topic,
      subtitle: `Node in Knowledge Graph (${t.meeting.title})`,
      badge: 'Graph Node',
      href: `/knowledge`,
    }));

    const results: SearchItem[] = [
      ...featureResults,
      ...meetingResults,
      ...decisionResults,
      ...actionResults,
      ...shariahResults,
      ...knowledgeResults,
    ];

    return reply.send({ results });
  });
}

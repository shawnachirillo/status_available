import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import {
  getPublicWebsite
} from '../../../lib/websites/publication';

import {
  WebsiteRenderer
} from '../../../components/website-renderer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Props = {
  params: Promise<{ slug: string }>;
};

export async function generateMetadata({
  params
}: Props): Promise<Metadata> {
  const { slug } = await params;
  const website = await getPublicWebsite(slug);

  if (!website) {
    return {
      title: 'Website unavailable',
      robots: { index: false, follow: false }
    };
  }

  return {
    title: {
      absolute: website.content.business
    },
    description: website.content.description,
    robots: { index: false, follow: false }
  };
}

export default async function PublishedWebsite({
  params
}: Props) {
  const { slug } = await params;
  const website = await getPublicWebsite(slug);

  if (!website) {
    notFound();
  }

  return (
    <main className="published-website">
      <WebsiteRenderer draft={website.content} />
    </main>
  );
}

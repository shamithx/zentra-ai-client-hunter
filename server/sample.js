import { db } from './db.js';
import { insertLead } from './lib/leads.js';

const SAMPLES = [
  {
    name: 'Harbor & Hearth Cafe',
    platform: 'instagram',
    profile_url: 'https://www.instagram.com/zentra_sample_harbor',
    post_url: 'https://www.instagram.com/p/ZENTRA-SAMPLE-1/',
    country: 'United States',
    category: 'Food & Beverage',
    followers: 8400,
    website: 'https://example.com/harbor-hearth',
    context: 'Neighborhood cafe posting daily specials. Recent reels are shot on a phone with no captions.',
    notes: 'Sample record for demonstration. Observed: good food visuals, weak first three seconds.',
  },
  {
    name: 'Northline Realty',
    platform: 'facebook',
    profile_url: 'https://www.facebook.com/zentra_sample_northline',
    country: 'Canada',
    category: 'Real Estate',
    followers: 12400,
    context: 'Realtor page posting listing photos and the occasional walkthrough video. Captions say walkthroughs are filmed on a phone.',
  },
  {
    name: 'Form Lab Fitness',
    platform: 'instagram',
    profile_url: 'https://www.instagram.com/zentra_sample_formlab',
    country: 'United Kingdom',
    category: 'Fitness & Wellness',
    followers: 3100,
    website: 'https://example.com/formlab',
    context: 'Online coaching business. Posts weekly reels of client workouts, edited in the phone app.',
    notes: 'Sample record for demonstration.',
  },
  {
    name: 'Aster Skin Studio',
    platform: 'instagram',
    profile_url: 'https://www.instagram.com/zentra_sample_asterskin',
    country: 'Australia',
    category: 'Beauty & Personal Care',
    followers: 5600,
    context: 'Salon posting before/after clips. Comments ask for full treatment videos.',
  },
  {
    name: 'Cielo Home Goods',
    platform: 'instagram',
    profile_url: 'https://www.instagram.com/zentra_sample_cielo',
    country: 'United States',
    category: 'E-commerce',
    followers: 22000,
    website: 'https://example.com/cielo',
    context: 'Shopify store running paid social. Product videos exist but look homemade.',
  },
  {
    name: 'Reyes Property Group',
    platform: 'instagram',
    profile_url: 'https://www.instagram.com/zentra_sample_reyes',
    country: 'United States',
    category: 'Real Estate',
    followers: 6800,
    context: 'Looking for a video editor to turn listing walkthroughs into short reels. Budget mentioned in a comment.',
    notes: 'Sample record for demonstration. Strong buying intent.',
  },
  {
    name: 'Mint & Mortar Studio',
    platform: 'facebook',
    profile_url: 'https://www.facebook.com/zentra_sample_mintmortar',
    country: 'Ireland',
    category: 'Home Services',
    followers: 1900,
    context: 'Interior design studio. Posts finished project photos, no video yet.',
  },
  {
    name: 'Juniper Trail Co.',
    platform: 'instagram',
    profile_url: 'https://www.instagram.com/zentra_sample_juniper',
    country: 'New Zealand',
    category: 'Travel & Hospitality',
    followers: 14500,
    context: 'Boutique tour operator with beautiful destination footage but inconsistent editing.',
  },
];

export function seedSamples() {
  let added = 0;
  let skipped = 0;
  for (const sample of SAMPLES) {
    const result = insertLead({ ...sample, source: 'sample' }, { allowCompetitor: true });
    if (result.added) added += 1;
    else skipped += 1;
  }
  return { added, skipped, total: SAMPLES.length };
}

export function removeSamples() {
  const result = db.prepare("DELETE FROM leads WHERE source = 'sample'").run();
  return { removed: Number(result.changes) };
}

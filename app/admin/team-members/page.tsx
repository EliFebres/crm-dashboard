import { redirect } from 'next/navigation';

// The Team Members roster now lives inside the Settings → Team & Office tab.
// Kept only to redirect any lingering bookmarks/links to the new location.
export default function TeamMembersRedirect() {
  redirect('/admin/settings?tab=team-office');
}

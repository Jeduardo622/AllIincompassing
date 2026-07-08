import { UserSettings } from '../components/settings/UserSettings';

export function Account() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">My Account</h1>
      </div>

      <UserSettings />
    </div>
  );
}

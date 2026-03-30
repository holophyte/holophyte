import ApiKeysPanel from '../components/ApiKeysPanel';

export default function SettingsRoute() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Manage your account settings and preferences.
        </p>
      </div>
      <div className="border-t pt-8">
        <ApiKeysPanel />
      </div>
    </div>
  );
}

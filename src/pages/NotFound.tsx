import { Compass, Home, Undo2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

export function NotFound() {
  const navigate = useNavigate();

  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <section className="w-full max-w-xl rounded-2xl border border-gray-200 bg-white p-6 text-center shadow-sm dark:border-gray-700 dark:bg-dark-lighter">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
          <Compass className="h-8 w-8" />
        </div>
        <h1 className="mt-4 text-3xl font-bold text-gray-900 dark:text-white">Page not found</h1>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">
          The address you entered does not match an available page.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:border-gray-600 dark:bg-dark dark:text-gray-200 dark:hover:bg-dark-card"
          >
            <Undo2 className="h-4 w-4" />
            Go back
          </button>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            <Home className="h-4 w-4" />
            Return home
          </button>
        </div>
      </section>
    </main>
  );
}

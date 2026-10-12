import { ApiKeyForm, selectApiKey } from '../features/api-key';
import { WorkspacePage } from '../pages/workspace/WorkspacePage';
import { useAppSelector } from '../shared/lib/redux';

export function App() {
  const apiKey = useAppSelector(selectApiKey);
  return apiKey ? <WorkspacePage /> : <ApiKeyForm />;
}

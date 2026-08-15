import { Redirect } from 'expo-router';

export default function LegacyCalendarRoute() {
  return <Redirect href={{ pathname: '/lists', params: { view: 'calendar' } }} />;
}

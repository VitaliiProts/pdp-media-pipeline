import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { PageHeading } from './PageHeading';

function renderPages() {
  const router = createMemoryRouter(
    [
      {
        path: '/library',
        element: <PageHeading>Library</PageHeading>,
      },
      { path: '/jobs', element: <PageHeading>Jobs</PageHeading> },
    ],
    { initialEntries: ['/library'] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('PageHeading', () => {
  it('names the tab and leaves focus alone on the first render', () => {
    renderPages();
    const heading = screen.getByRole('heading', { level: 1, name: 'Library' });
    expect(document.title).toBe('Library — PDP Media Pipeline');
    expect(heading).not.toHaveFocus();
    expect(document.body).toHaveFocus();
  });

  it('takes focus and renames the tab after navigation', async () => {
    const router = renderPages();
    await act(async () => {
      await router.navigate('/jobs');
    });
    expect(screen.getByRole('heading', { level: 1, name: 'Jobs' })).toHaveFocus();
    expect(document.title).toBe('Jobs — PDP Media Pipeline');
  });

  it('passes native props through and merges the class name', () => {
    render(
      <RouterProvider
        router={createMemoryRouter([
          {
            path: '/',
            element: (
              <PageHeading id="page-title" className="extra">
                Webhooks
              </PageHeading>
            ),
          },
        ])}
      />,
    );
    const heading = screen.getByRole('heading', { level: 1, name: 'Webhooks' });
    expect(heading).toHaveAttribute('id', 'page-title');
    expect(heading).toHaveClass('extra');
    expect(heading).toHaveAttribute('tabindex', '-1');
  });
});

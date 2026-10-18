import { baseApi } from '../../../shared/api/base-api';
import { httpStatusOf } from '../../../shared/api/http';
import { type AssetDetails, type AssetFilters, type AssetPage } from '../model/types';

export const ASSETS_PAGE_SIZE = 24;
/** Tag of every list page; a file's own page is tagged with its id. */
export const ASSET_LIST_TAG = { type: 'Asset', id: 'LIST' } as const;

function paramsOf({ kind, status, q, dubbed }: AssetFilters, cursor: string) {
  const query = q.trim();
  return {
    limit: ASSETS_PAGE_SIZE,
    ...(kind && { kind }),
    ...(status && { status }),
    ...(query && { q: query }),
    ...(dubbed && { dubbed: true }),
    ...(cursor && { cursor }),
  };
}

export const assetsApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listAssets: build.infiniteQuery<AssetPage, AssetFilters, string>({
      infiniteQueryOptions: {
        initialPageParam: '',
        getNextPageParam: (lastPage) => lastPage.nextCursor,
      },
      query: ({ queryArg, pageParam }) => ({
        url: '/v1/assets',
        params: paramsOf(queryArg, pageParam),
      }),
      providesTags: [ASSET_LIST_TAG],
    }),
    getAsset: build.query<AssetDetails, string>({
      query: (id) => ({ url: `/v1/assets/${encodeURIComponent(id)}` }),
      providesTags: (_result, _error, id) => [{ type: 'Asset', id }],
    }),
    // The file's own page is left alone: refetching it would only show a 404 on the way out.
    deleteAsset: build.mutation<void, string>({
      query: (id) => ({ url: `/v1/assets/${encodeURIComponent(id)}`, method: 'DELETE' }),
      invalidatesTags: (_result, error) =>
        error && httpStatusOf(error) !== 404 ? [] : [ASSET_LIST_TAG],
    }),
  }),
});

export const { useDeleteAssetMutation, useGetAssetQuery, useListAssetsInfiniteQuery } = assetsApi;

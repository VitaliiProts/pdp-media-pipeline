import { baseApi } from '../../../shared/api/base-api';
import {
  type CreatedWebhook,
  type CreateWebhookArgs,
  type DeliveryPage,
  type Webhook,
} from '../model/types';

export const DELIVERIES_PAGE_SIZE = 50;

const path = (id: string) => `/v1/webhooks/${encodeURIComponent(id)}`;

export const webhooksApi = baseApi.injectEndpoints({
  endpoints: (build) => ({
    listWebhooks: build.query<{ items: Webhook[] }, void>({
      query: () => ({ url: '/v1/webhooks' }),
      providesTags: ['Webhook'],
    }),
    createWebhook: build.mutation<CreatedWebhook, CreateWebhookArgs>({
      query: (body) => ({ url: '/v1/webhooks', method: 'POST', data: body }),
      invalidatesTags: ['Webhook'],
    }),
    deleteWebhook: build.mutation<void, string>({
      query: (id) => ({ url: path(id), method: 'DELETE' }),
      invalidatesTags: ['Webhook'],
    }),
    /** Deliveries are jobs, so a redrive (which invalidates `Job`) refetches them too. */
    listDeliveries: build.query<DeliveryPage, string>({
      query: (id) => ({ url: `${path(id)}/deliveries`, params: { limit: DELIVERIES_PAGE_SIZE } }),
      providesTags: ['Job', 'Webhook'],
    }),
  }),
});

export const {
  useListWebhooksQuery,
  useCreateWebhookMutation,
  useDeleteWebhookMutation,
  useListDeliveriesQuery,
} = webhooksApi;

{{/*
Replica management of one service (ADR-012), rendered by pdp-lib.app:

  autoscaling.metric: queue  KEDA ScaledObject, one nats-jetstream trigger per consumer.
                             Lag is num_pending + num_ack_pending, so jobs being processed
                             keep their pods; lagThreshold is the slots per pod.
  autoscaling.metric: cpu    HorizontalPodAutoscaler on CPU utilisation of the requests.

With several triggers the HPA takes the largest proposal, not the sum: a pod consuming two
queues scales on the busier one.
*/}}
{{- define "pdp-lib.scaling" -}}
{{- $name := include "pdp-lib.name" . -}}
{{- $as := .Values.autoscaling | default dict -}}
{{- if $as.enabled }}
{{- $behavior := dict "scaleDown" ($as.scaleDown | default (dict "stabilizationWindowSeconds" 60 "policies" (list (dict "type" "Pods" "value" 1 "periodSeconds" 30)))) }}
---
{{- if eq ($as.metric | default "queue") "queue" }}
{{- $min := hasKey $as "minReplicas" | ternary $as.minReplicas 1 }}
apiVersion: keda.sh/v1alpha1
kind: ScaledObject
metadata:
  name: {{ $name }}
  labels:
    {{- include "pdp-lib.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    name: {{ $name }}
  minReplicaCount: {{ $min }}
  maxReplicaCount: {{ required "autoscaling.maxReplicas" $as.maxReplicas }}
  {{- if eq (int $min) 0 }}
  # KEDA itself only decides 0 <-> 1; above that the HPA polls the lag and follows behavior.
  pollingInterval: {{ $as.pollingIntervalSeconds | default 10 }}
  cooldownPeriod: {{ $as.cooldownPeriodSeconds | default 300 }}
  {{- end }}
  advanced:
    horizontalPodAutoscalerConfig:
      behavior:
        {{- toYaml $behavior | nindent 8 }}
  triggers:
    {{- range required "autoscaling.consumers" $as.consumers }}
    - type: nats-jetstream
      metadata:
        natsServerMonitoringEndpoint: {{ $as.natsMonitoringEndpoint | default (printf "nats.%s.svc.cluster.local:8222" $.Release.Namespace) | quote }}
        account: {{ $as.natsAccount | default "$G" | quote }}
        stream: {{ .stream | quote }}
        consumer: {{ .consumer | quote }}
        lagThreshold: {{ required "autoscaling.lagThreshold" $as.lagThreshold | toString | quote }}
        activationLagThreshold: '0'
    {{- end }}
{{- else }}
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: {{ $name }}
  labels:
    {{- include "pdp-lib.labels" . | nindent 4 }}
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: {{ $name }}
  minReplicas: {{ $as.minReplicas | default 1 }}
  maxReplicas: {{ required "autoscaling.maxReplicas" $as.maxReplicas }}
  metrics:
    - type: Resource
      resource:
        name: cpu
        target:
          type: Utilization
          averageUtilization: {{ $as.targetCPUUtilizationPercentage | default 70 }}
  behavior:
    {{- toYaml $behavior | nindent 4 }}
{{- end }}
{{- end }}
---
# One pod at a time on drains and node upgrades; with a single replica it never blocks.
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ $name }}
  labels:
    {{- include "pdp-lib.labels" . | nindent 4 }}
spec:
  maxUnavailable: 1
  # A crash-looping pod protects nothing and must not hold up a drain.
  unhealthyPodEvictionPolicy: AlwaysAllow
  selector:
    matchLabels:
      {{- include "pdp-lib.selectorLabels" . | nindent 6 }}
{{- end -}}

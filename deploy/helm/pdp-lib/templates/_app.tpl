{{/*
ServiceAccount, Deployment, Service, PodDisruptionBudget, optional autoscaler (_scaling.tpl),
NetworkPolicy (_network.tpl) and Ingress of one service. A service chart only needs `{{ include "pdp-lib.app" . }}` and its values.yaml.

The ServiceAccount is the service's own, so an EKS Pod Identity association can give it an
AWS role. Its API token stays unmounted: the Pod Identity webhook projects a token of its own.

`shutdownGraceSeconds` (workers) sets WORKER_SHUTDOWN_GRACE_MS and a termination grace
15 s longer: 5 s for aborted jobs to hand themselves back, the rest for NATS and HTTP.
*/}}
{{- define "pdp-lib.app" -}}
{{- $name := include "pdp-lib.name" . -}}
{{- $port := .Values.containerPort | default 3000 -}}
{{- $probes := .Values.probes | default dict -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ $name }}
  labels:
    {{- include "pdp-lib.labels" . | nindent 4 }}
automountServiceAccountToken: false
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ $name }}
  labels:
    {{- include "pdp-lib.labels" . | nindent 4 }}
spec:
  {{- if not (dig "enabled" false (.Values.autoscaling | default dict)) }}
  replicas: {{ .Values.replicaCount | default 1 }}
  {{- end }}
  revisionHistoryLimit: 3
  selector:
    matchLabels:
      {{- include "pdp-lib.selectorLabels" . | nindent 6 }}
  strategy:
    type: RollingUpdate
    rollingUpdate:
      maxSurge: 1
      maxUnavailable: 0
  template:
    metadata:
      labels:
        {{- include "pdp-lib.labels" . | nindent 8 }}
    spec:
      serviceAccountName: {{ $name }}
      automountServiceAccountToken: false
      # Service links would add NATS_PORT=tcp://... and the like to every container.
      enableServiceLinks: false
      {{- with .Values.shutdownGraceSeconds }}
      terminationGracePeriodSeconds: {{ add . 15 }}
      {{- else }}
      terminationGracePeriodSeconds: {{ .Values.terminationGracePeriodSeconds | default 30 }}
      {{- end }}
      # Replicas on different nodes when there is room, so one node going away takes one.
      affinity:
        podAntiAffinity:
          preferredDuringSchedulingIgnoredDuringExecution:
            - weight: 100
              podAffinityTerm:
                topologyKey: kubernetes.io/hostname
                labelSelector:
                  matchLabels:
                    {{- include "pdp-lib.selectorLabels" . | nindent 20 }}
      securityContext:
        runAsNonRoot: true
        runAsUser: {{ .Values.runAsUser | default 1000 }}
        runAsGroup: {{ .Values.runAsUser | default 1000 }}
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: {{ $name }}
          image: {{ include "pdp-lib.image" . }}
          imagePullPolicy: {{ include "pdp-lib.pullPolicy" . }}
          {{- with .Values.command }}
          command:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          ports:
            - name: http
              containerPort: {{ $port }}
          env:
            {{- include "pdp-lib.env" . | trim | nindent 12 }}
          # Startup gives a slow start time without loosening liveness afterwards.
          startupProbe:
            httpGet: { path: {{ $probes.live | default "/health/live" }}, port: http }
            periodSeconds: 2
            failureThreshold: 30
          # Readiness checks the dependencies; liveness never does, or an outage of
          # Postgres or NATS would restart every pod instead of taking them out of service.
          readinessProbe:
            httpGet: { path: {{ $probes.ready | default "/health/ready" }}, port: http }
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3
          livenessProbe:
            httpGet: { path: {{ $probes.live | default "/health/live" }}, port: http }
            periodSeconds: 10
            timeoutSeconds: 3
            failureThreshold: 3
          {{- with .Values.preStopSleepSeconds }}
          # Keeps serving while the endpoint removal reaches kube-proxy and the ingress.
          lifecycle:
            preStop:
              sleep:
                seconds: {{ . }}
          {{- end }}
          resources:
            {{- toYaml .Values.resources | nindent 12 }}
          securityContext:
            {{- include "pdp-lib.containerSecurityContext" . | nindent 12 }}
          volumeMounts:
            - name: tmp
              mountPath: /tmp
            {{- with .Values.extraVolumeMounts }}
            {{- toYaml . | nindent 12 }}
            {{- end }}
      volumes:
        - name: tmp
          emptyDir:
            sizeLimit: {{ .Values.tmpSizeLimit | default "64Mi" }}
        {{- with .Values.extraVolumes }}
        {{- toYaml . | nindent 8 }}
        {{- end }}
---
apiVersion: v1
kind: Service
metadata:
  name: {{ $name }}
  labels:
    {{- include "pdp-lib.labels" . | nindent 4 }}
spec:
  selector:
    {{- include "pdp-lib.selectorLabels" . | nindent 4 }}
  ports:
    - name: http
      port: {{ .Values.servicePort | default $port }}
      targetPort: http
{{ include "pdp-lib.scaling" . }}
{{ include "pdp-lib.networkPolicy" . }}
{{- with .Values.ingress }}
{{- if .enabled }}
---
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: {{ $name }}
  labels:
    {{- include "pdp-lib.labels" $ | nindent 4 }}
  {{- with .annotations }}
  annotations:
    {{- toYaml . | nindent 4 }}
  {{- end }}
spec:
  {{- with .className }}
  ingressClassName: {{ . }}
  {{- end }}
  rules:
    {{- range .hosts }}
    - host: {{ .host }}
      http:
        paths:
          {{- range .paths | default (list "/") }}
          - path: {{ . }}
            pathType: Prefix
            backend:
              service:
                name: {{ $name }}
                port:
                  name: http
          {{- end }}
    {{- end }}
{{- end }}
{{- end }}
{{- end -}}

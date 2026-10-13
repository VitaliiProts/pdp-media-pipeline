{{/*
Resources are named after the chart, not the release, so in-cluster addresses match
docker-compose (http://metadata:3000, nats://nats:4222) and the env stays the same.
*/}}
{{- define "pdp-lib.name" -}}
{{- .Values.nameOverride | default .Chart.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "pdp-lib.selectorLabels" -}}
app.kubernetes.io/name: {{ include "pdp-lib.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "pdp-lib.tag" -}}
{{- .Values.image.tag | default (dig "image" "tag" "" (.Values.global | default dict)) | default .Chart.AppVersion -}}
{{- end -}}

{{- define "pdp-lib.labels" -}}
{{ include "pdp-lib.selectorLabels" . }}
app.kubernetes.io/version: {{ include "pdp-lib.tag" . | quote }}
app.kubernetes.io/component: {{ .Values.component | default "service" }}
app.kubernetes.io/part-of: pdp-media-pipeline
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "pdp-lib.image" -}}
{{- $registry := .Values.image.registry | default (dig "image" "registry" "" (.Values.global | default dict)) -}}
{{- if $registry -}}
{{ printf "%s/%s:%s" $registry .Values.image.repository (include "pdp-lib.tag" .) }}
{{- else -}}
{{ printf "%s:%s" .Values.image.repository (include "pdp-lib.tag" .) }}
{{- end -}}
{{- end -}}

{{- define "pdp-lib.pullPolicy" -}}
{{- .Values.image.pullPolicy | default (dig "image" "pullPolicy" "IfNotPresent" (.Values.global | default dict)) -}}
{{- end -}}

{{/*
Plain values from global.env, then the chart's env (wins), then secret references.
SERVICE_VERSION follows the image tag so traces and metrics carry the deployed version.
*/}}
{{- define "pdp-lib.env" -}}
{{- $env := merge (dict) (.Values.env | default dict) (dig "env" dict (.Values.global | default dict)) -}}
{{- if .Values.serviceVersionEnv -}}
{{- $_ := set $env "SERVICE_VERSION" (include "pdp-lib.tag" .) -}}
{{- end -}}
{{- with .Values.shutdownGraceSeconds -}}
{{- $_ := set $env "WORKER_SHUTDOWN_GRACE_MS" (mul . 1000) -}}
{{- end -}}
{{- range $name := keys $env | sortAlpha }}
- name: {{ $name }}
  value: {{ get $env $name | toString | quote }}
{{- end }}
{{- range $name := keys (.Values.secretEnv | default dict) | sortAlpha }}
{{- $ref := get $.Values.secretEnv $name }}
- name: {{ $name }}
  valueFrom:
    secretKeyRef:
      name: {{ $ref.secret }}
      key: {{ $ref.key }}
{{- end }}
{{- end -}}

{{- define "pdp-lib.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
capabilities:
  drop: [ALL]
{{- end -}}

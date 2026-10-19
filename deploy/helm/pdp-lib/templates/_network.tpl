{{/*
NetworkPolicy of one service, rendered by pdp-lib.app when networkPolicy.enabled:

  ingressFrom        names (app.kubernetes.io/name) of the services that may call the http
                     port; empty: none. The kubelet's probes are always allowed.
  egressPublicHttps  port 443 to addresses outside the private ranges (an external API).
                     A standard NetworkPolicy has no FQDNs, so this is as narrow as it gets.
  egressPodIdentity  the EKS Pod Identity agent on the node, where the AWS SDK gets the
                     credentials of the pod's role. The rest of 169.254/16 stays closed.

Egress always allows DNS and every pod of the namespace (NATS, Metadata, MinIO, collector).
*/}}
{{- define "pdp-lib.networkPolicy" -}}
{{- $np := .Values.networkPolicy | default dict -}}
{{- if $np.enabled }}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: {{ include "pdp-lib.name" . }}
  labels:
    {{- include "pdp-lib.labels" . | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      {{- include "pdp-lib.selectorLabels" . | nindent 6 }}
  policyTypes: [Ingress, Egress]
  ingress:
    {{- with $np.ingressFrom }}
    - from:
        {{- range . }}
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: {{ . }}
        {{- end }}
      ports:
        - port: http
    {{- else }} []
    {{- end }}
  egress:
    - to:
        - namespaceSelector: {}
          podSelector:
            matchLabels:
              k8s-app: kube-dns
      ports:
        - { port: 53, protocol: UDP }
        - { port: 53, protocol: TCP }
    - to:
        - podSelector: {}
    {{- if $np.egressPublicHttps }}
    - to:
        - ipBlock:
            cidr: 0.0.0.0/0
            except:
              - 10.0.0.0/8
              - 172.16.0.0/12
              - 192.168.0.0/16
              - 100.64.0.0/10
              # Instance metadata: no credentials of the node.
              - 169.254.0.0/16
      ports:
        - { port: 443, protocol: TCP }
    {{- end }}
    {{- if $np.egressPodIdentity }}
    - to:
        - ipBlock:
            cidr: 169.254.170.23/32
      ports:
        - { port: 80, protocol: TCP }
    {{- end }}
{{- end }}
{{- end -}}

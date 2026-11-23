#!/usr/bin/env sh
set -e
yq '(select(.kind == "Deployment" and (.metadata.name | test("-supabase-studio$"))) | .spec.template.spec) |= (
  del(.volumes[] | select(.name == "functions-storage")) |
  del(.containers[].volumeMounts[] | select(.name == "functions-storage")) |
  del(.containers[].env[] | select(.name == "EDGE_FUNCTIONS_MANAGEMENT_FOLDER"))
)'

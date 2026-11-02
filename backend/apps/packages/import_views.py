"""API de importación (ADR-012): subir → vista previa con el mapeo → confirmar. Solo el personal."""

from django.db import transaction
from django.utils import timezone
from rest_framework import serializers, status
from rest_framework.parsers import FormParser, JSONParser, MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.tenancy.context import app_db
from apps.tenancy.timefmt import iso_utc

from . import importing, services
from .models import ImportJob, Package
from .views import STAFF_ONLY

PREVIEW_ROWS = 50
MAX_ERRORS = 1000


def job_payload(job: ImportJob) -> dict:
    return {
        "id": str(job.id),
        "filename": job.filename,
        "status": job.status,
        "headers": job.headers,
        "sample": job.rows[:10],
        "total_rows": job.total_rows,
        "column_mapping": job.column_mapping,
        "suggested_mapping": importing.suggest_mapping(job.headers) if job.headers else {},
        "fields": [
            {"key": k, "label": v["label"], "required": bool(v.get("required"))} for k, v in importing.FIELDS.items()
        ],
        "ok_rows": job.ok_rows,
        "error_rows": job.error_rows,
        "errors": job.errors[:MAX_ERRORS],
        "created_at": iso_utc(job.created_at),
        "finished_at": iso_utc(job.finished_at),
    }


def failure(exc: importing.ImportError_) -> Response:
    return Response({"code": exc.code, "detail": exc.detail}, status=status.HTTP_400_BAD_REQUEST)


class MappingSerializer(serializers.Serializer):
    mapping = serializers.DictField(child=serializers.CharField(allow_null=True, allow_blank=True))


def flat_errors(results) -> list[dict]:
    return [{"row": r.row, **e} for r in results for e in r.errors][:MAX_ERRORS]


class ImportCreateView(APIView):
    """POST /api/v1/imports/ (multipart, campo `file`): lee el archivo y sugiere el mapeo."""

    permission_classes = STAFF_ONLY
    parser_classes = [MultiPartParser, FormParser]

    def post(self, request):
        upload = request.FILES.get("file")
        if upload is None:
            return Response({"code": "file_required", "detail": "Falta el archivo."}, status=status.HTTP_400_BAD_REQUEST)
        try:
            headers, rows = importing.read_table(upload.name, upload.read(importing.MAX_BYTES + 1))
        except importing.ImportError_ as exc:
            return failure(exc)
        job = ImportJob.objects.create(
            created_by=request.user,
            filename=upload.name[:255],
            headers=headers,
            rows=rows,
            total_rows=len(rows),
            column_mapping=importing.suggest_mapping(headers),
        )
        return Response({"import": job_payload(job)}, status=status.HTTP_201_CREATED)


class ImportDetailView(APIView):
    permission_classes = STAFF_ONLY

    def get(self, request, import_id):
        job = ImportJob.objects.filter(id=import_id).first()
        if job is None:
            return Response({"detail": "Importación no encontrada."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"import": job_payload(job)})


class ImportPreviewView(APIView):
    """POST /api/v1/imports/{id}/preview {mapping}: valida todas las filas sin crear nada."""

    permission_classes = STAFF_ONLY
    parser_classes = [JSONParser]

    def post(self, request, import_id):
        job = ImportJob.objects.filter(id=import_id).first()
        if job is None:
            return Response({"detail": "Importación no encontrada."}, status=status.HTTP_404_NOT_FOUND)
        if job.status == ImportJob.Status.DONE:
            return Response({"code": "already_done", "detail": "Esta importación ya se hizo."}, status=status.HTTP_409_CONFLICT)
        data = MappingSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        mapping = {k: v or None for k, v in data.validated_data["mapping"].items()}
        try:
            results = importing.evaluate(job.headers, job.rows, mapping)
        except importing.ImportError_ as exc:
            return failure(exc)
        job.column_mapping = mapping
        job.save(update_fields=["column_mapping", "updated_at"])
        ok = sum(1 for r in results if r.ok)
        return Response(
            {
                "summary": {"total_rows": len(results), "ok_rows": ok, "error_rows": len(results) - ok},
                "rows": [
                    {"row": r.row, "ok": r.ok, "values": r.values, "errors": r.errors} for r in results[:PREVIEW_ROWS]
                ],
                "errors": flat_errors(results),
            }
        )


class ImportConfirmView(APIView):
    """POST /api/v1/imports/{id}/confirm {mapping}: crea las filas válidas (una sola vez)."""

    permission_classes = STAFF_ONLY
    parser_classes = [JSONParser]

    def post(self, request, import_id):
        job = ImportJob.objects.select_for_update().filter(id=import_id).first()
        if job is None:
            return Response({"detail": "Importación no encontrada."}, status=status.HTTP_404_NOT_FOUND)
        if job.status == ImportJob.Status.DONE:
            return Response({"import": job_payload(job)})  # idempotente: no se importa dos veces
        data = MappingSerializer(data=request.data)
        data.is_valid(raise_exception=True)
        mapping = {k: v or None for k, v in data.validated_data["mapping"].items()}
        try:
            results = importing.evaluate(job.headers, job.rows, mapping)
        except importing.ImportError_ as exc:
            return failure(exc)
        errors = flat_errors(results)
        created = 0
        for r in results:
            if not r.ok:
                continue
            try:
                with transaction.atomic(using=app_db()):
                    services.create_package(
                        importing.package_input(r.values), request.user, source=Package.Source.IMPORT, import_job_id=job.id
                    )
                created += 1
            except services.PackageError as exc:  # por ejemplo, un código cargado mientras tanto
                errors.append({"row": r.row, "field": "tracking_code", "message": exc.detail})
        job.status = ImportJob.Status.DONE
        job.column_mapping = mapping
        job.ok_rows = created
        job.error_rows = len(results) - created
        job.errors = errors[:MAX_ERRORS]
        job.rows = []  # minimización: los datos ya están en los paquetes
        job.finished_at = timezone.now()
        job.save()
        return Response({"import": job_payload(job)})

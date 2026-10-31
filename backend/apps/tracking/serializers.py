from django.utils.dateparse import parse_datetime
from rest_framework import serializers

from .models import LocationPoint


class AwareDateTimeField(serializers.DateTimeField):
    """Exige zona horaria explícita (Z o ±hh:mm): la hora del teléfono no se interpreta."""

    def to_internal_value(self, value):
        if isinstance(value, str):
            parsed = parse_datetime(value)
            if parsed is not None and parsed.tzinfo is None:
                raise serializers.ValidationError("Falta la zona horaria (usar ISO 8601 con Z u offset).")
        return super().to_internal_value(value)


class PointSerializer(serializers.Serializer):
    point_id = serializers.UUIDField()
    recorded_at = AwareDateTimeField()
    lat = serializers.FloatField(min_value=-90, max_value=90)
    lng = serializers.FloatField(min_value=-180, max_value=180)
    accuracy = serializers.FloatField(min_value=0, max_value=100_000)
    speed = serializers.FloatField(min_value=0, max_value=150, required=False, allow_null=True)
    heading = serializers.FloatField(min_value=0, max_value=360, required=False, allow_null=True)
    altitude = serializers.FloatField(min_value=-1_000, max_value=10_000, required=False, allow_null=True)
    battery = serializers.FloatField(min_value=0, max_value=1, required=False, allow_null=True)
    is_moving = serializers.BooleanField(required=False, allow_null=True)
    source = serializers.ChoiceField(
        choices=LocationPoint.Source.choices, required=False, default=LocationPoint.Source.FOREGROUND
    )
    event = serializers.CharField(max_length=40, required=False, allow_blank=True)

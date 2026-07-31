unit MathUtils;

interface

function DoubleValue(Value: Integer): Integer;
procedure LogValue;

implementation

function DoubleValue(Value: Integer): Integer;
begin
  Result := Value * 2;
end;

procedure LogValue;
begin
  // DoubleValue(99) in a comment must not count as a call.
  WriteLn('DoubleValue(99) in a string must not count either');
end;

end.

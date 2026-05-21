from __future__ import annotations

from engine.retries import solve_with_retries
from input.audit import audit_solver_input
from model.builder import build_solver_model_context, build_solver_request
from output.extractor import extract_solver_result
from solver_core import solve_instance as solve_instance_core


def solve_instance(payload: dict | None) -> dict:
    """
    Authoritative solver entrypoint for the Python solver service.
    """
    normalized = build_solver_request(payload)
    context = build_solver_model_context(normalized)
    
    # Run pre-generation audit
    audit_diagnostics = audit_solver_input(context)
    
    request_payload = context.input.to_payload()
    def _solve_once(current_payload: dict) -> dict:
        return solve_instance_core(current_payload, model_context=context)

    result = solve_with_retries(_solve_once, request_payload, attempts=1)
    
    # Merge audit diagnostics into the result
    final_result = extract_solver_result(result, context.input)
    if "diagnostics" not in final_result:
        final_result["diagnostics"] = []
    
    # Add audit diagnostics (pre-solving)
    final_result["diagnostics"].extend(audit_diagnostics)
    
    return final_result

#!/bin/bash
# Start virtual display so Chrome runs non-headless, then exec cra-payroll.
export DISPLAY=:99
Xvfb :99 -screen 0 1280x1024x24 -nolisten tcp &
sleep 0.5
exec cra-payroll "$@"
